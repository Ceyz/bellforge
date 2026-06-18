// poolUpdateVerify — the pool-update correctness composed: the value invariant (x'·y'≥x·y) AND the token conservation
// (x==x'+tokenOut), cross-welded so x/x' are the SAME bytes in both halves. GREEN: a valid swap passes. REDs: k-decreasing,
// non-conserving, or x/x' inconsistent between the two halves all HALT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { poolUpdateVerifyOps, poolUpdateVerifyWitness, tiedInvariantGEWitness, swapConservationWitness } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const { ops } = poolUpdateVerifyOps(4, 8);
// valid swap: x→x' token decrease == tokenOut, and x'·y' ≥ x·y.
const run = (x, y, xp, yp, tokenOut) => () => runScript(ops, poolUpdateVerifyWitness({ x, y, xp, yp, tokenOut }));

test('poolUpdateVerify — a valid swap passes (invariant holds AND token conserved, x/x\' consistent)', () => {
  // BUY: pool gives token (x: 1000→600, tokenOut=400), receives BELLS (y: 100→200) ⟹ k: 100000 → 120000 ≥ ✓
  assert.doesNotThrow(run(1000n, 100n, 600n, 200n, 400n), 'k grows + token conserved');
  assert.doesNotThrow(run(1000n, 100n, 500n, 200n, 500n), '100000 == 100000, conserved');
});

test('poolUpdateVerify RED — k-decreasing swap HALTs (the value half)', () => {
  assert.throws(run(1000n, 100n, 600n, 150n, 400n), /VERIFY/, '90000 < 100000 must HALT');
});

test('poolUpdateVerify RED — token NOT conserved HALTs (the token half)', () => {
  assert.throws(run(1000n, 100n, 600n, 200n, 401n), /NUMEQUALVERIFY|VERIFY/, 'x != x\'+tokenOut must HALT');
});

test('poolUpdateVerify RED — x\' INCONSISTENT between the invariant and the conservation halves is rejected by the weld', () => {
  // invariant uses x'=600 (k passes), conservation uses x'=500 with tokenOut=500 (conserves) — but the weld forces them equal.
  const wInv = tiedInvariantGEWitness({ x: 1000n, y: 100n, xp: 600n, yp: 200n });     // invariant x'=600
  const wCons = swapConservationWitness(1000n, 500n, 500n);                            // conservation x'=500 (1000=500+500)
  assert.throws(() => runScript(ops, [...wInv, ...wCons]), /EQUALVERIFY/, 'x\' differing across halves must HALT at the weld');
});

test('poolUpdateVerify — BUDGET', () => {
  const meta = poolUpdateVerifyOps(4, 8);
  const r = runScript(ops, poolUpdateVerifyWitness({ x: 1000n, y: 100n, xp: 600n, yp: 200n, tokenOut: 400n }));
  console.log(`\n  [poolUpdateVerify u64 budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}  witnessItems=${meta.totalDepth}`);
  assert.ok(r.peakStack < 1000);
});
