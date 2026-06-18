// Decompose the BIP-342 tapscript sighash into its component fields, so a covenant can
// reconstruct it on-stack from witness-supplied parts (the B1 introspection primitive).
// Byte layout mirrors belcoinjs-lib hashForWitnessV1 (proven node-exact by canary C2g).
import * as bells from 'belcoinjs-lib';

const S = bells.crypto.sha256;
// L-01 fix (audit 2026-06-14): these sighash helpers are security-critical, so validate strictly like wire.mjs
// (the old `n >>> 0` silently wrapped negatives/floats/>=2^32 — a footgun for a witness builder). Reject anything
// that is not the exact integer in range.
export const u32 = (n) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`u32 out of range / non-integer: ${n}`); const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const i32 = (n) => { if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff) throw new Error(`i32 out of range / non-integer: ${n}`); const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
export const u64 = (n) => {
  if (typeof n !== 'bigint' && !Number.isSafeInteger(n)) throw new Error(`u64 must be a bigint or a safe integer: ${n}`);
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n || v > (1n << 64n) - 1n) throw new Error(`u64 out of range [0, 2^64): ${v}`);
  const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b;
};
function compactSize(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}
export const varslice = (buf) => Buffer.concat([compactSize(buf.length), buf]);

export const TAPSIGHASH_TAG = S(Buffer.from('TapSighash'));

// MANDATORY for every CSFS+CHECKSIG leaf: pin the pubkey + sig sizes BEFORE the binding.
// BIP-342: a pubkey whose size is neither 0 nor 32 bytes is an "unknown public key type" and
// CHECKSIG/CSFS then SUCCEED WITHOUT VERIFYING — that bypass is CONSENSUS-VALID, only policy-rejected
// (DISCOURAGE_UPGRADABLE_PUBKEYTYPE), so a non-32B witness pubkey defeats the whole binding on mainnet.
// OP_SIZE + OP_EQUALVERIFY are base opcodes (enforced under all flags) -> a consensus-level reject.
// Precondition: stack top is [.., P, sig] (sig on top); postcondition identical. Proven by
// canaries/pubkey_size_pin.test.mjs (vuln minable; pinned -> block-validation-failed).
const _O = bells.opcodes;
export const CSFS_PUBKEY_SIG_PINS = [
  _O.OP_SIZE, bells.script.number.encode(64), _O.OP_EQUALVERIFY, // |sig| == 64 (SIGHASH_DEFAULT; no 65-byte variant)
  _O.OP_SWAP,                                                    // P on top
  _O.OP_SIZE, bells.script.number.encode(32), _O.OP_EQUALVERIFY, // |P| == 32 (reject unknown-pubkey-type bypass)
  _O.OP_SWAP,                                                    // sig on top (restored)
];

// Single-input, SIGHASH_DEFAULT, tapscript (no annex) component hashes.
// inputs: [{ txid, vout, value, spk, sequence }] ; outputs: [{ value, script }]
export function sighashComponents({ inputs, outputs }) {
  const shaPrevouts = S(Buffer.concat(inputs.map((i) => Buffer.concat([Buffer.from(i.txid, 'hex').reverse(), u32(i.vout)]))));
  const shaAmounts = S(Buffer.concat(inputs.map((i) => u64(i.value))));
  const shaScriptPubKeys = S(Buffer.concat(inputs.map((i) => varslice(i.spk))));
  const shaSequences = S(Buffer.concat(inputs.map((i) => u32(i.sequence))));
  const shaOutputs = S(Buffer.concat(outputs.map((o) => Buffer.concat([u64(o.value), varslice(o.script)]))));
  return { shaPrevouts, shaAmounts, shaScriptPubKeys, shaSequences, shaOutputs };
}

// Reassemble the tapscript sighash from components (what the covenant does on-stack).
// `pre` = hashType||nVersion||nLockTime ; `mid` = spendType||inIndex ; `post` = key_version||codesep.
export function reassembleSighash({ version = 2, locktime = 0, inIndex = 0, leafHash, parts }) {
  const pre = Buffer.concat([Buffer.from([0x00]), i32(version), u32(locktime)]);            // 9B
  const mid = Buffer.concat([Buffer.from([0x02]), u32(inIndex)]);                            // 5B
  const post = Buffer.concat([Buffer.from([0x00]), Buffer.from([0xff, 0xff, 0xff, 0xff])]);  // 5B
  const message = Buffer.concat([
    pre, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences,
    parts.shaOutputs, mid, leafHash, post,
  ]);
  // sighash = SHA256( tag || tag || 0x00(epoch) || message )
  return { message, pre, mid, post, sighash: S(Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00]), message])) };
}
