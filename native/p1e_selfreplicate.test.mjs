// P1e-1 (on-chain) — covenant SELF-REPLICATION: a token-note spend is forced to send output[0] back to
// the SAME covenant scriptPubKey. The covenant reconstructs c4 = SHA256(varslice(ownSPK)) from a witness
// ownSPK and builds output[0] = value‖varslice(ownSPK); the CSFS+CHECKSIG binding forces c4 == the REAL
// input SPK hash (so ownSPK is the covenant's own SPK) AND sha_outputs == real (so output[0] really is it).
// A transfer that redirects the note to a DIFFERENT address is rejected at CONSENSUS — the anti-leak/anti-
// theft core of the token note. (SECURITY_PLAN §7 TOKEN TOPOLOGY; single-input only.)
//
// Run (regtest up): node --test p1e_selfreplicate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u64, varslice } from './sighashParts.mjs';
import { p1e1Ops, buildP1e1Script } from './p1eCovenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP1e-1 SKIPPED — ${skip}\n`);

const FUND = toSats(1), FEE = 10000, OUT0 = 100000; // output[0] = the replicated token note (dust carrier)

// `out0Spk` = the SPK the REAL output[0] is sent to (honest: the covenant; theft: an attacker address).
// `ownSpk` = the SPK the covenant is TOLD to replicate (witness). Honest spend has both == cov.output.
function buildSpend({ cov, f, dest, out0Spk, ownSpk, simCheck = false }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(f.fundTxid, 'hex').reverse(), f.vout, 0xffffffff);
  const changeVal = f.valueSats - OUT0 - FEE;
  tx.addOutput(out0Spk, OUT0);     // output[0] = (would-be) replicated token note
  tx.addOutput(dest, changeVal);   // output[1] = free change

  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: f.fundTxid, vout: f.vout, value: f.valueSats, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: OUT0, script: out0Spk }, { value: changeVal, script: dest }],
  });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [f.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const priv = Buffer.alloc(32, 0x3e);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const out1 = Buffer.concat([u64(changeVal), varslice(dest)]); // serialized output[1] for the c6 computation
  // c4 (shaScriptPubKeys) and c6 (shaOutputs) are COMPUTED in-script — NOT passed as witness items.
  const witnessData = [c1, parts.shaPrevouts, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9, out1, u64(OUT0), ownSpk, P, sig];

  if (simCheck) {
    const r = runScript(p1e1Ops(), witnessData, real);
    assert.ok(r.ok, 'stack simulator rejected the honest self-replicating spend');
  }
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

async function minable(hex) { // generateblock validates under CONSENSUS rules
  const addr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: WALLET });
  try { await rpc('generateblock', [addr, [hex], true], { wallet: WALLET }); return { mined: true }; }
  catch (e) { return { mined: false, error: e.message.split(':').slice(-1)[0].trim() }; }
}

// C1 EMBEDDED-NEEDLE FULL-LEAK attack (audit 2026-06-13): the FULL value goes to an attacker P2TR (output[0]);
// the 35-byte needle 0x22‖covSPK is planted inside a 0-value OP_RETURN (output[1]); the witness slides the
// boundary so out0Value (NOT 8 bytes) absorbs the real prefix up to the needle. Pre-fix this MINED (note leaked);
// the |out0Value|==8 pin must now reject it at CONSENSUS. ownSPK=cov.output keeps c4 matching the real input SPK.
function buildLeakSpend({ cov, f }) {
  const attackerSpk = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, 0xaa)]); // attacker P2TR
  const needle = Buffer.concat([Buffer.from([0x22]), cov.output]);                        // 0x22 ‖ covSPK (35B)
  const opret = Buffer.concat([Buffer.from([0x6a, needle.length]), needle]);              // OP_RETURN push(needle)
  const outs = [{ value: f.valueSats - FEE, script: attackerSpk }, { value: 0, script: opret }];
  const ser = Buffer.concat(outs.map((o) => Buffer.concat([u64(o.value), varslice(o.script)])));
  const k = ser.indexOf(needle);
  assert.ok(k !== 8 && k > 0, `needle offset ${k} should be the slide (≠8)`);
  const out0Value = ser.subarray(0, k);             // length k ≠ 8 — the boundary slide
  const out1 = ser.subarray(k + needle.length);

  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(f.fundTxid, 'hex').reverse(), f.vout, 0xffffffff);
  for (const o of outs) tx.addOutput(o.script, o.value);
  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({ inputs: [{ txid: f.fundTxid, vout: f.vout, value: f.valueSats, spk: cov.output, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [f.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const priv = Buffer.alloc(32, 0x3e);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const witnessData = [c1, parts.shaPrevouts, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9, out1, out0Value, cov.output, P, sig];
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('P1e-1: covenant forces output[0] back to its OWN scriptPubKey; redirecting the note is rejected at consensus', { skip }, async () => {
  const cov = makeCovenantRaw(buildP1e1Script());
  console.log(`\nP1e-1 covenant addr: ${cov.address} (leaf ${cov.leaf.length}B)`);
  const dest = await destSpk();
  const attacker = await destSpk(); // a non-covenant address the thief would send the note to

  // RED — THEFT: real output[0] goes to the attacker, witness ownSPK = the covenant (tries to keep c4 valid).
  // covenant builds c6 from cov.output -> reconstructed sha_outputs != real (output[0] is attacker) -> reject.
  const f1 = await fund(cov, 1);
  const theftHex = buildSpend({ cov, f: f1, dest, out0Spk: attacker, ownSpk: cov.output });
  const mp = await expectReject(theftHex);
  console.log(`P1e-1 note-redirect rejected (mempool): ${mp}`);
  const m = await minable(theftHex);
  assert.equal(m.mined, false, 'redirecting the token note to a non-covenant SPK MUST be rejected at CONSENSUS');
  console.log(`P1e-1 note-redirect rejected at CONSENSUS (block-level): ${m.error}`);

  // RED — THEFT variant: witness ownSPK = attacker too (so c6 matches the real output), but then the
  // reconstructed c4 = SHA256(varslice(attacker)) != real shaScriptPubKeys (input is the covenant) -> reject.
  const f2 = await fund(cov, 1);
  const theft2Hex = buildSpend({ cov, f: f2, dest, out0Spk: attacker, ownSpk: attacker });
  await expectReject(theft2Hex);
  const m2 = await minable(theft2Hex);
  assert.equal(m2.mined, false, 'a consistent-but-foreign ownSPK must still break c4 at CONSENSUS');
  console.log(`P1e-1 c4-mismatch redirect rejected at CONSENSUS: ${m2.error}`);

  // RED — C1 EMBEDDED-NEEDLE FULL LEAK (the audit's CRITICAL): full value to attacker, covSPK only inside an
  // OP_RETURN, out0Value slid to a non-8-byte length. The |out0Value|==8 pin must reject this at CONSENSUS.
  const f4 = await fund(cov, 1);
  const leakHex = buildLeakSpend({ cov, f: f4 });
  const lr = await expectReject(leakHex);
  console.log(`P1e-1 C1 embedded-needle leak rejected (mempool): ${lr}`);
  assert.match(lr, /EQUALVERIFY|equal|size|verify|false/i, `unexpected: ${lr}`);
  const lm = await minable(leakHex);
  assert.equal(lm.mined, false, 'C1 full-value leak (slid out0Value) MUST be rejected at CONSENSUS by the |out0Value|==8 pin');
  console.log(`P1e-1 C1 embedded-needle leak rejected at CONSENSUS: ${lm.error}`);

  // GREEN — honest self-replication: output[0] = the covenant's own SPK, witness ownSPK = it too.
  const f3 = await fund(cov, 1);
  const okHex = buildSpend({ cov, f: f3, dest, out0Spk: cov.output, ownSpk: cov.output, simCheck: true });
  const { txid, confirmations } = await expectAccept(okHex);
  assert.ok(confirmations >= 1, 'self-replicating transfer not confirmed');
  console.log(`P1e-1 self-replication confirmed: ${txid} (${confirmations} conf) — output[0] forced to the same covenant\n`);
});
