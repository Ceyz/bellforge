// On-stack ALL|ANYONECANPAY (0x81) sighash reconstruction — the BUY pool leaf's introspection core. The covenant rebuilds the
// ACP message from witness pieces, SHA256s it, and binds it via CSFS (computed == the real sighash). Proves the covenant can
// introspect the open-input-set sighash. Witness (deepest→top): shaOutputs(32), committedTxid(32, internal order), amount(8 LE),
// ownSPK(34), sequence(4 LE), leafHash(32), sig(64), P(32). version=2/locktime=0/vout=0 baked here. The amount field is the pool's
// own UTXO value y — bound to the REAL spent value because the same `sig` must also pass CHECKSIG over the real sighash (the 65-byte
// auth epilogue is a SEPARATE brick; scriptsim can't model a 65B CHECKSIG). Layout proven node-exact in sighash_all_acp.test.mjs.
import * as bells from 'belcoinjs-lib';
import { i32, u32, TAPSIGHASH_TAG } from './sighashParts.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

export function allAcpReconOps({ vout = 0, version = 2, locktime = 0, auth = false } = {}) {
  const A = { shaOutputs: 0, committedTxid: 1, amount: 2, ownSPK: 3, sequence: 4, leafHash: 5, sig: 6, P: 7 };
  const PRE = Buffer.concat([B(0x81), i32(version), u32(locktime)]);              // hashType ‖ nVersion ‖ nLockTime
  const VOUT_LE = u32(vout);
  const POST = Buffer.concat([B(0x00), B(0xff, 0xff, 0xff, 0xff)]);               // key_version ‖ codesep
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);        // tag ‖ tag ‖ epoch
  const ops = []; let depth = 8;
  const DELTA = { [O.OP_CAT]: -1, [O.OP_SIZE]: 1, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_VERIFY]: -1, [O.OP_CHECKSIG]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pinSize = (abs, n) => { pick(abs); e(O.OP_SIZE, enc(n), O.OP_EQUALVERIFY, O.OP_DROP); };  // |field| == n (BIND, net 0)

  pinSize(A.shaOutputs, 32); pinSize(A.committedTxid, 32); pinSize(A.amount, 8);
  pinSize(A.ownSPK, 34); pinSize(A.sequence, 4); pinSize(A.leafHash, 32);
  // CRITICAL (audit P0): pin |P|==32 and |sig|==64 BEFORE the CSFS. A non-32-byte pubkey is an "unknown pubkey type" ⟹ CSFS/CHECKSIG
  // SUCCEED WITHOUT VERIFYING (consensus-valid, only policy-rejected) ⟹ the whole binding is bypassed ⟹ pool drain. (Scriptsim masks
  // this by hard-throwing on |P|!=32, so this needs a regtest canary like canaries/pubkey_size_pin.test.mjs.)
  pinSize(A.P, 32); pinSize(A.sig, 64);

  // head = PRE ‖ shaOutputs ‖ spend_type(0x02)
  e(PRE); pick(A.shaOutputs); e(O.OP_CAT); e(B(0x02), O.OP_CAT);
  // inputData = committedTxid ‖ vout ‖ amount ‖ varslice(ownSPK)=0x22‖ownSPK ‖ sequence  — built on top of head
  pick(A.committedTxid); e(VOUT_LE, O.OP_CAT);
  pick(A.amount); e(O.OP_CAT);
  e(B(0x22), O.OP_CAT); pick(A.ownSPK); e(O.OP_CAT);
  pick(A.sequence); e(O.OP_CAT);
  e(O.OP_CAT);                                                                   // head ‖ inputData
  pick(A.leafHash); e(O.OP_CAT); e(POST, O.OP_CAT);                              // ‖ leafHash ‖ post = message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                                   // computed = SHA256(PREFIX ‖ message)
  pick(A.sig); e(O.OP_SWAP); pick(A.P);                                          // [.., sig, computed, P]
  ops.push(0xcc); depth -= 2;                                                    // CSFS: computed == real sighash → [.., 1]
  if (!auth) return { ops };                                                     // recon-only: leave the CSFS result

  // ----- 65-byte CHECKSIG auth epilogue (Agent A P1: dual-sig, SINGLE-SOURCED) -----
  e(O.OP_VERIFY);                                                               // consume the CSFS [1] (computed now bound to real)
  // built = sig64 ‖ 0x81 — CAT the SAME sig64 the CSFS verified (NOT a fresh witness blob) ⟹ no CSFS/CHECKSIG sig-decoupling.
  pick(A.sig); e(B(0x81), O.OP_CAT);
  e(O.OP_SIZE, enc(65), O.OP_EQUALVERIFY);                                       // |built| == 65 (last byte is 0x81 by construction)
  pick(A.P); e(O.OP_CHECKSIG);                                                   // CHECKSIG(sig64‖0x81, P) over the REAL sighash → [1]
  return { ops };
}

export function allAcpReconWitness({ shaOutputs, committedTxid, amount, ownSPK, sequence, leafHash, sig, P }) {
  return [shaOutputs, committedTxid, amount, ownSPK, sequence, leafHash, sig, P];
}
