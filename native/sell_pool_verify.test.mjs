// sellPoolUpdateVerify — the SELL-direction pool-update verification (token deposit d ⟹ x'=x+d, BELLS out ⟹ y'<y, invariant
// x'·y'≥x·y). GREEN: a valid SELL passes. REDs: k-decreasing, x' != x+d (token not conserved), and inconsistent x across halves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './scriptsim.mjs';
import { sellPoolUpdateVerifyOps, sellPoolUpdateVerifyWitness, tiedInvariantGEWitness, swapConservationWitness } from './mulGadget.mjs';

const { ops } = sellPoolUpdateVerifyOps(4, 8);
const run = (x, y, xp, yp, d) => () => runScript(ops, sellPoolUpdateVerifyWitness({ x, y, xp, yp, d }));

test('sellPoolVerify — a valid SELL passes (deposit d ⟹ x\'=x+d, y\' down, invariant holds)', () => {
  // pool: token 600→1000 (trader deposits d=400), BELLS 84M→51M (trader gets 33M) ⟹ k: 600·84M=5.04e10 → 1000·51M=5.1e10 ≥ ✓
  assert.doesNotThrow(run(600n, 84_000_000n, 1000n, 51_000_000n, 400n), 'x\'=x+d, k grows');
  assert.doesNotThrow(run(600n, 84_000_000n, 1000n, 50_400_000n, 400n), 'k exactly preserved (1000·50.4M == 600·84M)');
});

test('sellPoolVerify RED — k-DECREASING HALTs (the value half)', () => {
  assert.throws(run(600n, 84_000_000n, 1000n, 50_000_000n, 400n), /VERIFY/, '1000·50M < 600·84M must HALT');
});

test('sellPoolVerify RED — x\' != x + d HALTs (the token half)', () => {
  assert.throws(run(600n, 84_000_000n, 1001n, 51_000_000n, 400n), /NUMEQUALVERIFY|VERIFY/, '1001 != 600+400 must HALT');
});

test('sellPoolVerify RED — x INCONSISTENT between the invariant and the conservation is rejected by the (crossed) weld', () => {
  const wInv = tiedInvariantGEWitness({ x: 600n, y: 84_000_000n, xp: 1000n, yp: 51_000_000n });   // invariant x=600
  const wCons = swapConservationWitness(1000n, 700n, 300n);                                         // conservation x_old=700 (1000=700+300)
  assert.throws(() => runScript(ops, [...wInv, ...wCons]), /EQUALVERIFY/, 'x differing across halves must HALT at the weld');
});

test('sellPoolVerify — BUDGET', () => {
  const r = runScript(ops, sellPoolUpdateVerifyWitness({ x: 600n, y: 84_000_000n, xp: 1000n, yp: 51_000_000n, d: 400n }));
  console.log(`\n  [sellPoolVerify budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}`);
  assert.ok(r.peakStack < 1000);
});
