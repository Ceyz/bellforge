// buyPoolLeafFullOps (backtrace=true) — the FULLY COMPLETE BUY leaf: pool-update verification + the real $BOUND interleaved
// note‖stateOut topology (everything single-sourced into c6/inline) + the depth-2 BACKTRACE binding old-x to the parent.
// GREEN: a valid BUY passes. REDs: k-decreasing, token-not-conserved, a tampered bound output, and a FORGED old-x all HALT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { sighashComponentsAllAcp, reassembleSighashAllAcp } from './sighashPartsAllAcp.mjs';
import { buyPoolLeafFullOps, buyPoolLeafFullWitness, buyPoolLeafOutputs, buyPoolParent } from './buyLeaf.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);
const p2tr = (s) => Buffer.concat([h('5120'), x32(s)]);
const owner20 = (b) => h(String(b).repeat(40)).subarray(0, 20);

const poolSPK = p2tr(7), traderSPK = p2tr(2), changeSPK = p2tr(3);
const poolOwner = owner20(5), traderOwner = owner20(6);
const seq = 0xffffffff, leafHash = x32(9);
const traderVal = 9_000n, changeVal = 1_000n;
const X = 1000n, Y = 50_000_000n, XP = 600n, YP = 84_000_000n, TO = 400n;       // valid BUY (k: 5e10 → 5.04e10)

// the parent tx (the prior swap) carries old-x=X in its pool stateOut ⟹ committedTxid = its txid = the spent note's outpoint.
const parentPrefix = h('0200000001' + 'ab'.repeat(40));                          // arbitrary parent bytes (incl. its variable inputs)
const parentSuffix = h('cd'.repeat(30) + '00000000');
const committedTxid = buyPoolParent({ x: X, poolOwner, parentPrefix, parentSuffix }).committedTxid;
const covTxid = Buffer.from(committedTxid).reverse().toString('hex');           // display order for belcoinjs

const outsFor = (yp, xp, to) => buyPoolLeafOutputs({ yp, poolSPK, xp, poolOwner, traderVal, traderSPK, tokenOut: to, traderOwner, changeVal, changeSPK });
const realSighash = (y, outs) => reassembleSighashAllAcp({
  version: 2, locktime: 0, leafHash,
  ...sighashComponentsAllAcp({ input: { txid: covTxid, vout: 0, value: Number(y), spk: poolSPK, sequence: seq }, outputs: outs }),
}).sighash;

const meta = buyPoolLeafFullOps();
const { ops } = meta;
const wit = ({ x = X, y = Y, xp = XP, yp = YP, tokenOut = TO } = {}) => buyPoolLeafFullWitness({
  x, y, xp, yp, tokenOut, poolSPK, poolOwner, traderSPK, traderVal, traderOwner, changeVal, changeSPK,
  committedTxid, sequence: seq, leafHash, sig: Buffer.alloc(64, 7), P: Buffer.alloc(32, 9), parentPrefix, parentSuffix,
});

test('buyPoolLeafFull — the FULLY COMPLETE BUY (verification + stateOut topology + old-x backtrace) passes', () => {
  const r = runScript(ops, wit(), realSighash(Y, outsFor(YP, XP, TO)));
  assert.ok(r.main[r.main.length - 1].equals(Buffer.from([1])), 'the complete BUY leaf must pass');
});

test('buyPoolLeafFull RED — k-DECREASING swap HALTs (verification)', () => {
  const yp = 80_000_000n;
  assert.throws(() => runScript(ops, wit({ yp }), realSighash(Y, outsFor(yp, XP, TO))), /VERIFY/, 'k decreased must HALT');
});

test('buyPoolLeafFull RED — token NOT conserved HALTs (verification)', () => {
  assert.throws(() => runScript(ops, wit({ tokenOut: 401n }), realSighash(Y, outsFor(YP, XP, 401n))), /NUMEQUALVERIFY|VERIFY/, 'x != x\'+tokenOut must HALT');
});

test('buyPoolLeafFull RED — a tampered bound output breaks the ACP binding', () => {
  assert.throws(() => runScript(ops, wit(), realSighash(Y, outsFor(YP + 1n, XP, TO))), /CSFS message/, 'mismatched bound outputs must HALT');
});

test('buyPoolLeafFull RED — a FORGED old-x (≠ the parent\'s pool stateOut amount) is rejected by the backtrace', () => {
  // claim old-x=999 (with x'=599, tokenOut=400 ⟹ conserved), but committedTxid is the parent for old-x=1000.
  assert.throws(() => runScript(ops, wit({ x: 999n, xp: 599n, tokenOut: 400n }), realSighash(Y, outsFor(YP, 599n, 400n))), /EQUALVERIFY/, 'a forged old-x must HALT at the backtrace');
});

test('buyPoolLeafFull RED — a non-32-byte pubkey P HALTs at the |P|==32 pin (the audit-P0 fix)', () => {
  const w = wit();
  w[meta.puvSize + 11] = Buffer.alloc(33, 9);            // P := 33 bytes (the unknown-pubkey-type bypass)
  assert.throws(() => runScript(ops, w, realSighash(Y, outsFor(YP, XP, TO))), /EQUALVERIFY/, '|P|!=32 must HALT (else CSFS/CHECKSIG pass without verifying ⟹ pool drain)');
});

test('buyPoolLeafFull — BUDGET (the FULLY COMPLETE leaf)', () => {
  const r = runScript(ops, wit(), realSighash(Y, outsFor(YP, XP, TO)));
  console.log(`\n  [buyPoolLeafFull COMPLETE+backtrace budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}  witnessItems=${meta.fullDepth}`);
  assert.ok(r.peakStack < 1000);
});
