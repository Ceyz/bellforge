// P1d-v1 (on-chain) — the CONSERVATION GATE: a token transfer's OUTPUT amount is forced to equal the
// BACKTRACE-PROVEN INPUT amount (mono-input / mono-output). Conservation is BY CONSTRUCTION: STAGE 1
// proves the spent input's token amount (P1c), and STAGE 4 builds the output token-state from that SAME
// proven amount and binds it to the real tx output via sha_outputs + CSFS+CHECKSIG (B4). An inflated
// output (real OP_RETURN state commits more than the input held) makes the reconstructed sha_outputs
// differ from the real one -> the shared (sig, P) can't satisfy both CSFS (computed) and CHECKSIG (real)
// -> consensus reject. This is the on-chain anti-inflation gate that closes the CAT20 exploit class.
// (SECURITY_PLAN §7 P1d-v1; design figé by the conservation-design workflow 2026-06-13.)
//
// Canary scope: c2=shaPrevouts is passed directly (B4 shortcut) and the input prev-txid is a leaf
// constant (P1c isolation) — the PRODUCTION guard routes c2 through P1b. Mono-in/mono-out; multi-output
// splits need the deferred base-256 byte-limb adder. Run (regtest up): node --test p1d_conservation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u32, u64, varslice } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { p1dOps, buildP1dScript } from './p1dCovenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP1d SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256;
const FUND = toSats(1), FEE = 10000;

// A synthetic input prev-tx whose vout[1] is the canonical state OP_RETURN committing T_in (like p1c).
function buildPrevTx(stateHash) {
  const version = u32(2), vinCount = Buffer.from([0x01]);
  const input = Buffer.concat([Buffer.alloc(32, 0x77), u32(0), Buffer.from([0x00]), Buffer.from('ffffffff', 'hex')]);
  const voutCount = Buffer.from([0x02]);
  const tokenScript = Buffer.alloc(22, 0x51);
  const out0 = Buffer.concat([u64(12345n), Buffer.from([tokenScript.length]), tokenScript]);
  const stateScript = Buffer.concat([Buffer.from([0x6a, 0x20]), stateHash]);
  const out1 = Buffer.concat([u64(0n), Buffer.from([stateScript.length]), stateScript]);
  const full = Buffer.concat([version, vinCount, input, voutCount, out0, out1, u32(0)]);
  return { full, out1Start: 4 + 1 + input.length + 1 + out0.length };
}

// Build a transfer spend. `tOut` is what the REAL output[0] state commits (honest: == tIn; inflated: > tIn).
// The covenant ALWAYS rebuilds the output amount from the proven input amount (amount_in_ser = encode(tIn)).
function buildSpend({ cov, f, tid, committedTxid, pre, post, ownerIn, outOwner, tIn, tOut, simCheck = false, badP = false }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(f.fundTxid, 'hex').reverse(), f.vout, 0xffffffff);
  const outState = encodeState({ tokenId: tid, amount: tOut, owner: outOwner });
  const out0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), S(outState)]); // OP_RETURN PUSH32 stateHash
  const changeVal = f.valueSats - FEE;
  const dest = cov.dest;
  tx.addOutput(out0Script, 0);
  tx.addOutput(dest, changeVal);

  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: f.fundTxid, vout: f.vout, value: f.valueSats, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: 0, script: out0Script }, { value: changeVal, script: dest }],
  });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [f.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const priv = Buffer.alloc(32, 0x2d);
  // badP: a 33-byte pubkey would be an "unknown pubkey type" — CHECKSIG/CSFS pass WITHOUT verifying at consensus
  // (only policy-rejected). The |P|==32 pin must reject it CONSENSUS-side (OP_EQUALVERIFY), not rely on policy.
  const P = badP ? Buffer.alloc(33, 0x07) : Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv)); // signs the REAL sighash (so CHECKSIG always holds)
  const out1 = Buffer.concat([u64(changeVal), varslice(dest)]);
  const amountInSer = encodeAmount(tIn);
  const witnessData = [sig, P, c1, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, c7, leafHash, c9, out1, outOwner, post, pre, amountInSer, ownerIn];

  if (simCheck) { // offline guard: the covenant's computed sighash must equal the real one for an HONEST spend
    const r = runScript(p1dOps({ tokenId: tid, preLen: pre.length, committedTxid }), witnessData, real);
    assert.ok(r.ok, 'stack simulator rejected the honest spend');
  }
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('P1d-v1: output token amount is forced == backtrace-proven input amount; an inflated transfer is rejected', { skip }, async () => {
  const tid = tokenId({ genesisTxidInternal: Buffer.alloc(32, 0x09), genesisVout: 1 });
  const ownerIn = Buffer.alloc(20, 0xa1);
  const outOwner = Buffer.alloc(20, 0xb2);
  const tIn = 1_000_000n;

  // synthetic input prev-tx committing tIn -> committedTxid (leaf constant, P1c isolation)
  const inState = encodeState({ tokenId: tid, amount: tIn, owner: ownerIn });
  const { full: prevTx, out1Start } = buildPrevTx(S(inState));
  const committedTxid = bells.crypto.hash256(prevTx);
  const pre = prevTx.subarray(0, out1Start);
  const post = prevTx.subarray(out1Start + 43);
  assert.ok(pre.length <= 80 && post.length <= 80, 'pre/post must be ≤80B (P1d-v1 mono-chunk)');

  const cov = makeCovenantRaw(buildP1dScript({ tokenId: tid, preLen: pre.length, committedTxid }));
  cov.dest = await destSpk();
  console.log(`\nP1d-v1 covenant addr: ${cov.address} (leaf ${cov.leaf.length}B, tIn=${tIn})`);

  const f1 = await fund(cov, 1);
  const base = { cov, tid, committedTxid, pre, post, ownerIn, outOwner, tIn };

  // RED — inflation: the REAL output state commits 1000x the input. Covenant rebuilds out0 from the proven
  // tIn -> reconstructed sha_outputs != real -> CSFS over computed != CHECKSIG over real -> reject.
  // Verify at the BLOCK level (consensus), not just mempool — this is THE core security property, and the
  // bellsd mempool string ("non-mandatory…") is not a reliable consensus/policy signal on this path.
  const inflatedHex = buildSpend({ ...base, f: f1, tOut: 1_000_000_000n });
  const reason = await expectReject(inflatedHex);
  console.log(`P1d-v1 inflated transfer rejected (mempool): ${reason}`);
  const iAddr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: WALLET });
  let iMined = false, iErr = '';
  try { await rpc('generateblock', [iAddr, [inflatedHex], true], { wallet: WALLET }); iMined = true; }
  catch (e) { iErr = e.message.split(':').slice(-1)[0].trim(); }
  assert.equal(iMined, false, 'INFLATION must be rejected at CONSENSUS (generateblock), not just mempool policy');
  console.log(`P1d-v1 inflation rejected at CONSENSUS (block-level): ${iErr}`);

  // RED — non-32B pubkey (BIP-342 upgradable-pubkey footgun): must be rejected at CONSENSUS by the |P|==32
  // pin, NOT left to a non-mandatory policy flag (else inflatable on mainnet). We verify at the BLOCK level
  // via generateblock (which validates under consensus rules) — the mempool string is not a reliable
  // consensus/policy signal on bellsd. (See canaries/pubkey_size_pin.test.mjs for the bare-CHECKSIG proof.)
  const f1b = await fund(cov, 1);
  const badHex = buildSpend({ ...base, f: f1b, tOut: tIn, badP: true });
  const mAddr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: WALLET });
  let mined = false, mineErr = '';
  try { await rpc('generateblock', [mAddr, [badHex], true], { wallet: WALLET }); mined = true; }
  catch (e) { mineErr = e.message.split(':').slice(-1)[0].trim(); }
  assert.equal(mined, false, 'the |P|==32 pin MUST reject the 33-byte pubkey at CONSENSUS (generateblock), not just policy');
  console.log(`P1d-v1 non-32B pubkey rejected at CONSENSUS (block-level): ${mineErr}`);

  // GREEN — honest conservation: output commits exactly the proven input amount. (fresh UTXO, serial harness)
  const f2 = await fund(cov, 1);
  const { txid, confirmations } = await expectAccept(buildSpend({ ...base, f: f2, tOut: tIn, simCheck: true }));
  assert.ok(confirmations >= 1, 'honest conserving transfer not confirmed');
  console.log(`P1d-v1 honest transfer confirmed: ${txid} (${confirmations} conf) — output amount == proven input amount enforced on-chain\n`);
});
