// ALL|ANYONECANPAY (0x81) component reassembly == belcoinjs hashForWitnessV1, for a MULTI-input tx (pool covenant @vin0 +
// trader funding @vin1). This is the layout the BUY pool leaf rebuilds on-stack. GREEN proves: (1) byte-exact vs the library
// (consensus-correct), (2) ALL commits EVERY output (tweaking/omitting any output changes the sighash — the property SINGLE|ACP
// LACKS and why reusing the 0x83 helper would be fatal), (3) ACP ignores extra funding inputs (the open input set). No node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { sighashComponentsAllAcp, reassembleSighashAllAcp } from './sighashPartsAllAcp.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);
const ALL_ACP = bells.Transaction.SIGHASH_ALL | bells.Transaction.SIGHASH_ANYONECANPAY; // 0x01 | 0x80 = 0x81

const covSpk = Buffer.concat([h('5120'), x32(7)]);                       // pool covenant SPK (input 0)
const buyerSpk = Buffer.concat([h('0014'), h('bb'.repeat(20))]);        // trader funding input 1 (P2WPKH)
const covValue = 10000, buyerValue = 50_000_000;
const covTxid = x32(3).toString('hex'), buyerTxid = x32(4).toString('hex');
const leafHash = x32(9);

const poolOut = { value: 30_000_000, script: Buffer.concat([h('5120'), x32(1)]) };   // output 0 = pool note'
const traderOut = { value: 19_990_000, script: Buffer.concat([h('5120'), x32(2)]) }; // output 1 = trader token note
const changeOut = { value: 9_000, script: Buffer.concat([h('0014'), h('cc'.repeat(20))]) }; // output 2 = trader change

function scenario(outputs, extraInput = true) {
  const tx = new bells.Transaction();
  tx.version = 2; tx.locktime = 0;
  tx.addInput(h(covTxid).reverse(), 0, 0xffffffff);                     // input 0 = pool covenant
  const prevSpks = [covSpk], prevVals = [covValue];
  if (extraInput) { tx.addInput(h(buyerTxid).reverse(), 1, 0xfffffffd); prevSpks.push(buyerSpk); prevVals.push(buyerValue); }
  for (const o of outputs) tx.addOutput(o.script, o.value);
  const canonical = tx.hashForWitnessV1(0, prevSpks, prevVals, ALL_ACP, leafHash);
  const parts = sighashComponentsAllAcp({
    input: { txid: covTxid, vout: 0, value: covValue, spk: covSpk, sequence: 0xffffffff },
    outputs,
  });
  const { sighash, message } = reassembleSighashAllAcp({ version: 2, locktime: 0, hashType: 0x81, ...parts, leafHash });
  return { canonical, sighash, message };
}

test('ALL|ACP reassembly == belcoinjs hashForWitnessV1 (pool@vin0 + trader funding @vin1)', () => {
  const { canonical, sighash, message } = scenario([poolOut, traderOut, changeOut]);
  console.log(`\n  ALL|ACP canonical:   ${canonical.toString('hex')}`);
  console.log(`  ALL|ACP reassembled: ${sighash.toString('hex')}  (message ${message.length}B)`);
  assert.ok(sighash.equals(canonical), 'ALL|ACP reassembly does NOT match belcoinjs');
});

test('ALL commits EVERY output — tweaking output[1] changes the sighash (the property SINGLE|ACP lacks)', () => {
  const base = scenario([poolOut, traderOut, changeOut]);
  const tweak = scenario([poolOut, { ...traderOut, value: traderOut.value - 1 }, changeOut]);
  assert.ok(!base.sighash.equals(tweak.sighash), 'shrinking output[1] by 1 sat MUST change the ALL sighash');
  assert.ok(tweak.sighash.equals(tweak.canonical), 'and the tweaked tx still matches belcoinjs');
});

test('ALL pins the whole set — OMITTING an output changes the sighash (no hidden-output/omission)', () => {
  const full = scenario([poolOut, traderOut, changeOut]);
  const dropped = scenario([poolOut, traderOut]);                       // omit the change output
  assert.ok(!full.sighash.equals(dropped.sighash), 'omitting an output MUST change the sighash');
  assert.ok(dropped.sighash.equals(dropped.canonical), 'and still matches belcoinjs');
});

test('ACP ignores extra inputs — the trader funding input does NOT change the sighash (open input set)', () => {
  const withE = scenario([poolOut, traderOut, changeOut], true);
  const without = scenario([poolOut, traderOut, changeOut], false);
  assert.ok(withE.canonical.equals(without.canonical), 'belcoinjs: ACP sighash must be identical with/without the extra input');
  assert.ok(withE.sighash.equals(withE.canonical) && without.sighash.equals(without.canonical), 'both match belcoinjs');
});

test('reassembly tracks the spent VALUE inline — changing the pool input value changes the sighash', () => {
  // self-consistency: the inline amount is in the message, so a different spent value yields a different sighash.
  const a = scenario([poolOut, traderOut, changeOut]);
  const tx = new bells.Transaction(); tx.version = 2; tx.locktime = 0;
  tx.addInput(h(covTxid).reverse(), 0, 0xffffffff);
  for (const o of [poolOut, traderOut, changeOut]) tx.addOutput(o.script, o.value);
  const canonical2 = tx.hashForWitnessV1(0, [covSpk], [covValue + 1], ALL_ACP, leafHash);
  const parts2 = sighashComponentsAllAcp({ input: { txid: covTxid, vout: 0, value: covValue + 1, spk: covSpk, sequence: 0xffffffff }, outputs: [poolOut, traderOut, changeOut] });
  const { sighash: s2 } = reassembleSighashAllAcp({ version: 2, locktime: 0, hashType: 0x81, ...parts2, leafHash });
  assert.ok(s2.equals(canonical2), 'value+1 reassembly matches belcoinjs');
  assert.ok(!a.sighash.equals(s2), 'a different spent value must change the ALL|ACP sighash (inline amount is bound)');
});
