// buyPoolLeafOps — the COMPLETE BUY pool leaf: pool-update VERIFICATION (invariant + conservation, x/x' welded) THEN the
// output-construction + ALL|ACP BINDING (self-replicated pool note), with y'→output[0].value and y→inline-ACP-value welded.
// GREEN: a valid BUY passes (the invariant's BELLS reserves ARE the real bound tx values). REDs: k-decreasing HALTs; a y' that
// doesn't match the bound output[0].value is rejected by the weld. (x'/tokenOut→stateOuts + the old-x backtrace are the flagged
// remaining wiring, see buyLeaf.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { sighashComponentsAllAcp, reassembleSighashAllAcp } from './sighashPartsAllAcp.mjs';
import { buyPoolLeafOps, buyPoolLeafWitness } from './buyLeaf.mjs';
import { u64 } from './sighashParts.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);
const p2tr = (s) => Buffer.concat([h('5120'), x32(s)]);

const poolSPK = p2tr(7), traderSPK = p2tr(2), changeSPK = p2tr(3);
const covTxid = x32(4).toString('hex'), seq = 0xffffffff, leafHash = x32(9);
const traderVal = 9_000, changeVal = 1_000;

const realSighash = (y, yp) => reassembleSighashAllAcp({
  version: 2, locktime: 0, leafHash,
  ...sighashComponentsAllAcp({
    input: { txid: covTxid, vout: 0, value: y, spk: poolSPK, sequence: seq },
    outputs: [{ value: yp, script: poolSPK }, { value: traderVal, script: traderSPK }, { value: changeVal, script: changeSPK }],
  }),
}).sighash;

const meta = buyPoolLeafOps();
const { ops } = meta;
const wit = ({ x, y, xp, yp, tokenOut }) => buyPoolLeafWitness({
  x, y, xp, yp, tokenOut, poolSPK, traderVal, traderSPK, changeVal, changeSPK,
  committedTxid: Buffer.from(covTxid, 'hex').reverse(), sequence: seq, leafHash, sig: Buffer.alloc(64, 7), P: Buffer.alloc(32, 9),
});

// a valid BUY: token reserve 1000→600 (trader gets 400), BELLS reserve 50M→84M (trader funds) ⟹ k: 1000·50M → 600·84M = 5.04e10 ≥ 5e10
const X = 1000n, Y = 50_000_000n, XP = 600n, YP = 84_000_000n, TO = 400n;

test('buyPoolLeaf — a valid BUY passes (invariant + conservation + BELLS reserves bound to the real tx)', () => {
  const r = runScript(ops, wit({ x: X, y: Y, xp: XP, yp: YP, tokenOut: TO }), realSighash(Number(Y), Number(YP)));
  assert.ok(r.main[r.main.length - 1].equals(Buffer.from([1])), 'the complete BUY leaf must pass');
});

test('buyPoolLeaf RED — a k-DECREASING swap HALTs (the verification half)', () => {
  const yp = 80_000_000n;                                 // 600·80M = 4.8e10 < 5e10
  assert.throws(() => runScript(ops, wit({ x: X, y: Y, xp: XP, yp, tokenOut: TO }), realSighash(Number(Y), Number(yp))), /VERIFY/, 'k decreased must HALT');
});

test('buyPoolLeaf RED — y\' NOT == the bound output[0].value is rejected by the weld', () => {
  // the verification uses y'=84M (invariant holds), but the BOUND output[0].value = 83M ⟹ the weld y'==output[0].value fails.
  const w = wit({ x: X, y: Y, xp: XP, yp: YP, tokenOut: TO });
  w[meta.puvSize] = u64(83_000_000n);                     // tamper the binding's yp (= output[0].value) to 83M
  assert.throws(() => runScript(ops, w, realSighash(Number(Y), 83_000_000)), /EQUALVERIFY/, 'y\' != output[0].value must HALT at the weld');
});

test('buyPoolLeaf — BUDGET (the complete leaf)', () => {
  const r = runScript(ops, wit({ x: X, y: Y, xp: XP, yp: YP, tokenOut: TO }), realSighash(Number(Y), Number(YP)));
  console.log(`\n  [buyPoolLeaf COMPLETE budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}  witnessItems=${meta.fullDepth}`);
  assert.ok(r.peakStack < 1000);
});
