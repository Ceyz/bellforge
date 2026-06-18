// BUY pool leaf core — the covenant BUILDS shaOutputs on-stack (incl. the self-replicated successor pool note) and binds it via
// ALL|ACP. GREEN: the built outputs + message == the real belcoinjs sighash, CSFS+CHECKSIG pass. REDs: tampering ANY output, or
// the successor pool note's SPK (breaking self-replication / redirecting the pool), breaks the binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { sighashComponentsAllAcp, reassembleSighashAllAcp } from './sighashPartsAllAcp.mjs';
import { buyAcpBindOps, buyAcpBindWitness } from './buyLeaf.mjs';
import { u64, u32 } from './sighashParts.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);
const p2tr = (seed) => Buffer.concat([h('5120'), x32(seed)]);

const poolSPK = p2tr(7);                       // the pool's own SPK (input AND the successor output[0])
const y = 50_000_000;                          // OLD pool BELLS value (the spent UTXO value, inline)
const yp = 60_000_000;                         // NEW pool BELLS value (trader funded +10M)
const traderSPK = p2tr(2), changeSPK = p2tr(3);
const traderVal = 9_000, changeVal = 1_000;    // (token note dust + change; values illustrative)
const covTxid = x32(4).toString('hex'), seq = 0xffffffff, leafHash = x32(9);

function realSighash(outs) {
  const { inputData, shaOutputs } = sighashComponentsAllAcp({ input: { txid: covTxid, vout: 0, value: y, spk: poolSPK, sequence: seq }, outputs: outs });
  return reassembleSighashAllAcp({ version: 2, locktime: 0, inputData, shaOutputs, leafHash }).sighash;
}
const baseOuts = () => [
  { value: yp, script: poolSPK },              // output[0] = successor pool note (self-replicated)
  { value: traderVal, script: traderSPK },     // output[1] = trader token note
  { value: changeVal, script: changeSPK },     // output[2] = change
];
const wit = (over = {}) => buyAcpBindWitness({
  yp: u64(yp), poolSPK, traderVal: u64(traderVal), traderSPK, changeVal: u64(changeVal), changeSPK,
  committedTxid: Buffer.from(covTxid, 'hex').reverse(), amount: u64(y), sequence: u32(seq), leafHash,
  sig: Buffer.alloc(64, 7), P: Buffer.alloc(32, 9), ...over,
});
const { ops } = buyAcpBindOps({ vout: 0, auth: true });

test('BUY leaf — built outputs (self-replicated pool note) bind via ALL|ACP', () => {
  const r = runScript(ops, wit(), realSighash(baseOuts()));
  assert.ok(r.main[r.main.length - 1].equals(Buffer.from([1])), 'CSFS+CHECKSIG must pass — built shaOutputs == real sighash');
});

test('BUY leaf RED — tampering the successor pool note value y\' breaks the binding', () => {
  // real sighash for y'=60M, but the witness/build claims a different y' ⟹ shaOutputs mismatch.
  assert.throws(() => runScript(ops, wit({ yp: u64(yp + 1) }), realSighash(baseOuts())), /CSFS message/, 'wrong y\' must mismatch');
});

test('BUY leaf RED — redirecting the successor pool note SPK (breaking self-replication) breaks the binding', () => {
  const r = realSighash(baseOuts());            // committed pool note is at poolSPK
  assert.throws(() => runScript(ops, wit({ poolSPK: p2tr(99) }), r), /CSFS message|EQUALVERIFY/, 'a different pool SPK must mismatch the bound outputs');
});

test('BUY leaf RED — tampering a trader output breaks the binding (ALL pins every output)', () => {
  assert.throws(() => runScript(ops, wit({ traderVal: u64(traderVal + 1) }), realSighash(baseOuts())), /CSFS message/, 'output[1] tweak must mismatch');
});

test('BUY leaf — BUDGET', () => {
  const r = runScript(ops, wit(), realSighash(baseOuts()));
  console.log(`\n  [BUY leaf core budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}`);
  assert.ok(r.peakStack < 1000);
});
