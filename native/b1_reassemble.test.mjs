// B1 (off-chain math) — prove the component-wise tapscript-sighash reassembly matches
// belcoinjs-lib hashForWitnessV1 exactly. This is the byte layout the B1 introspection
// covenant will rebuild on-stack with OP_CAT. No node needed.
//
// Run: node --test b1_reassemble.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);

test('B1: component reassembly == belcoinjs hashForWitnessV1 (tapscript SIGHASH_DEFAULT)', () => {
  // A covenant prevout (P2TR) + the spending tx (1 input, 2 outputs).
  const prevSpk = Buffer.concat([h('5120'), x32(7)]);       // covenant scriptPubKey
  const prevValue = 100000;
  const inputTxid = x32(3).toString('hex');
  const inputVout = 0;
  const sequence = 0xffffffff;
  const leafHash = x32(9);                                   // the covenant's tapleaf hash

  const out0 = { value: 90000, script: Buffer.concat([h('0014'), h('aa'.repeat(20))]) }; // P2WPKH
  const out1 = { value: 5000, script: Buffer.concat([h('5120'), x32(5)]) };              // P2TR

  // Build the same tx with belcoinjs and compute the canonical sighash.
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.locktime = 0;
  tx.addInput(h(inputTxid).reverse(), inputVout, sequence);
  tx.addOutput(out0.script, out0.value);
  tx.addOutput(out1.script, out1.value);
  const canonical = tx.hashForWitnessV1(0, [prevSpk], [prevValue], bells.Transaction.SIGHASH_DEFAULT, leafHash);

  // Our component-wise reassembly.
  const parts = sighashComponents({
    inputs: [{ txid: inputTxid, vout: inputVout, value: prevValue, spk: prevSpk, sequence }],
    outputs: [out0, out1],
  });
  const { sighash, message } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });

  console.log(`\nB1 canonical sighash:  ${canonical.toString('hex')}`);
  console.log(`B1 reassembled sighash: ${sighash.toString('hex')}`);
  console.log(`B1 message length: ${message.length} bytes\n`);
  assert.ok(sighash.equals(canonical), 'component reassembly does NOT match belcoinjs sighash');
});
