// B2 (on-chain) — payment covenant: output[0] forced to a committed payment, output[1] free.
// Spend paying the committed seller (+ a free change output) -> accepted. Spend paying a DIFFERENT
// address -> rejected (the CSFS binding fails: real sha_outputs != SHA256(committed ‖ out1)).
//
// Run (regtest node up): node --test b2_covenant.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { buildB2Script, serializeOutput } from './b2Covenant.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nB2 SKIPPED — ${skip}\n`);

const FUND = toSats(1);
const FEE = 10000;
const PAY = 30_000_000;            // committed payment to the seller (output 0)
const CHANGE = FUND - FEE - PAY;   // spender's free output (output 1)

// Build a 2-output script-path spend and its witness for the B2 covenant.
function buildSpend({ cov, fundTxid, vout, sellerScript, buyerScript }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(fundTxid, 'hex').reverse(), vout, 0xffffffff);
  tx.addOutput(sellerScript, PAY);   // output 0 (must == committed)
  tx.addOutput(buyerScript, CHANGE); // output 1 (free)
  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: fundTxid, vout, value: FUND, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: PAY, script: sellerScript }, { value: CHANGE, script: buyerScript }],
  });
  const { pre, mid, post, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [FUND], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const priv = Buffer.alloc(32, 0x22);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const out1 = serializeOutput(CHANGE, buyerScript); // the covenant rebuilds sha_outputs from committedOut0 ‖ out1

  const witnessData = [pre, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, out1, mid, leafHash, post, P, sig];
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('B2: payment covenant — pays committed seller accepted, wrong payee rejected', { skip }, async () => {
  const seller = await destSpk();
  const buyer = await destSpk();
  const attacker = await destSpk();

  const committedOut0 = serializeOutput(PAY, seller);
  const cov = makeCovenantRaw(buildB2Script(committedOut0));
  console.log(`\nB2 covenant addr: ${cov.address} (leaf ${cov.leaf.length}B)`);

  const f = await fund(cov, 1);
  assert.equal(f.valueSats, FUND);
  const base = { cov, fundTxid: f.fundTxid, vout: f.vout, buyerScript: buyer };

  // Negative: pay the ATTACKER at output 0 (with the same free change) -> real sha_outputs differs
  // from SHA256(committed ‖ out1) -> CSFS binding fails.
  const reason = await expectReject(buildSpend({ ...base, sellerScript: attacker }));
  console.log(`B2 wrong-payee rejected as expected: ${reason}`);
  assert.match(reason, /Schnorr|signature|verify|false|stack/i, `unexpected: ${reason}`);

  // Positive: pay the committed seller at output 0, keep change at output 1 -> accepted.
  const { txid, confirmations } = await expectAccept(buildSpend({ ...base, sellerScript: seller }));
  assert.ok(confirmations >= 1, 'committed-payment spend not confirmed');
  console.log(`B2 committed-payment spend confirmed: ${txid} (${confirmations} conf) — output[0] pinned, output[1] free\n`);
});
