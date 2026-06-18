// H-DEX1 (off-chain math) — prove the SIGHASH_SINGLE|ANYONECANPAY component reassembly matches
// belcoinjs hashForWitnessV1 exactly, for a MULTI-input tx (covenant input 0 + a buyer-added input 1).
// This is the layout the buyer-funded sell-order covenant rebuilds on-stack. No node needed.
//
// Run: node --test hdex1_acp_reassemble.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { sighashComponentsAcp, reassembleSighashAcp } from './sighashPartsAcp.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);

test('H-DEX1: SINGLE|ACP reassembly == belcoinjs hashForWitnessV1 (buyer adds input 1)', () => {
  const SINGLE_ACP = bells.Transaction.SIGHASH_SINGLE | bells.Transaction.SIGHASH_ANYONECANPAY; // 0x83
  const covSpk = Buffer.concat([h('5120'), x32(7)]);   // seller covenant scriptPubKey (input 0)
  const buyerSpk = Buffer.concat([h('0014'), h('bb'.repeat(20))]); // buyer funding input 1
  const covValue = 10000, buyerValue = 50_000_000;
  const covTxid = x32(3).toString('hex'), buyerTxid = x32(4).toString('hex');
  const leafHash = x32(9);

  // output 0 = the committed seller payment (what SINGLE pins to the covenant input 0)
  const sellerPay = { value: 30_000_000, script: Buffer.concat([h('0014'), h('aa'.repeat(20))]) };
  // outputs 1,2 = buyer's free outputs (asset receive + change) — NOT committed under SINGLE
  const buyerOut = { value: 19_990_000, script: Buffer.concat([h('5120'), x32(5)]) };

  const tx = new bells.Transaction();
  tx.version = 2; tx.locktime = 0;
  tx.addInput(h(covTxid).reverse(), 0, 0xffffffff);     // input 0 = covenant
  tx.addInput(h(buyerTxid).reverse(), 1, 0xfffffffd);   // input 1 = buyer (RBF)
  tx.addOutput(sellerPay.script, sellerPay.value);      // output 0 (committed)
  tx.addOutput(buyerOut.script, buyerOut.value);        // output 1 (free)
  // belcoinjs requires prevout script/value for ALL inputs; only input 0 enters the ACP sighash
  const canonical = tx.hashForWitnessV1(0, [covSpk, buyerSpk], [covValue, buyerValue], SINGLE_ACP, leafHash);

  const parts = sighashComponentsAcp({
    input: { txid: covTxid, vout: 0, value: covValue, spk: covSpk, sequence: 0xffffffff },
    singleOutput: sellerPay,
  });
  const { sighash, message } = reassembleSighashAcp({ version: 2, locktime: 0, hashType: 0x83, ...parts, leafHash });

  console.log(`\nH-DEX1 canonical:    ${canonical.toString('hex')}`);
  console.log(`H-DEX1 reassembled:  ${sighash.toString('hex')}`);
  console.log(`H-DEX1 message: ${message.length} bytes (vs ~211 for DEFAULT — ACP is leaner)\n`);
  assert.ok(sighash.equals(canonical), 'SINGLE|ACP reassembly does NOT match belcoinjs');
});
