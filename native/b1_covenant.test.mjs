// B1 (on-chain) — the introspection covenant enforces a committed output set via CSFS binding.
// Deploy a covenant committing "single output (V, S)"; spend with a DIFFERENT output -> rejected
// (sha_outputs != H_target); spend with EXACTLY (V, S) -> accepted. Proves the covenant reads and
// constrains the real spending tx's outputs. (Keystone for the native token — docs/NATIVE_TOKEN.md.)
//
// Run (regtest node up): node --test b1_covenant.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, notMinable } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { buildB1Script, outputsHash } from './b1Covenant.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nB1 SKIPPED — ${skip}\n`);

const FUND_SATS = toSats(1);   // sendtoaddress 1 BEL -> 100,000,000-sat covenant vout
const FEE = 10000;
const V = FUND_SATS - FEE;     // committed output value

// Build the script-path spend: input = covenant UTXO, output = (value, destScript); sign with belcoinjs sighash.
function buildSpend({ cov, fundTxid, vout, value, outScript }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(fundTxid, 'hex').reverse(), vout, 0xffffffff);
  tx.addOutput(outScript, value);
  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: fundTxid, vout, value: FUND_SATS, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value, script: outScript }],
  });
  const { pre, mid, post, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  // sanity: our reassembly must equal the node-exact belcoinjs sighash (proven by C2g)
  const real = tx.hashForWitnessV1(0, [cov.output], [FUND_SATS], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const priv = Buffer.alloc(32, 0x21);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));

  // witness stack (deepest->top): c1..c9, P, sig
  const witnessData = [
    pre, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences,
    parts.shaOutputs, mid, leafHash, post, P, sig,
  ];
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('B1: introspection covenant — committed output accepted, different output rejected', { skip }, async () => {
  const destOK = await destSpk();   // the committed payee
  const destBad = await destSpk();  // a different payee

  const hTarget = outputsHash([{ value: V, script: destOK }]);
  const cov = makeCovenantRaw(buildB1Script(hTarget));
  console.log(`\nB1 covenant addr: ${cov.address} (leaf ${cov.leaf.length}B)`);

  const f = await fund(cov, 1);
  assert.equal(f.valueSats, FUND_SATS, `funded value ${f.valueSats} != ${FUND_SATS}`);
  const base = { cov, fundTxid: f.fundTxid, vout: f.vout, value: V };

  // Negative: spend to a DIFFERENT output -> real sha_outputs != H_target -> EQUALVERIFY fails.
  const badHex = buildSpend({ ...base, outScript: destBad });
  const reason = await expectReject(badHex);
  console.log(`B1 wrong-output rejected (mempool): ${reason}`);
  assert.match(reason, /false|empty|stack|verify|equal/i, `unexpected reject reason: ${reason}`);
  const bm = await notMinable(badHex); // N6: the introspection keystone must reject at CONSENSUS, not just policy
  assert.equal(bm.mined, false, 'B1 wrong-output MUST be rejected at CONSENSUS (generateblock)');
  console.log(`B1 wrong-output rejected at CONSENSUS: ${bm.error}`);

  // Positive: spend with EXACTLY the committed output -> accepted.
  const { txid, confirmations } = await expectAccept(buildSpend({ ...base, outScript: destOK }));
  assert.ok(confirmations >= 1, 'committed-output spend not confirmed');
  console.log(`B1 committed-output spend confirmed: ${txid} (${confirmations} conf) — covenant read + enforced the tx outputs\n`);
});
