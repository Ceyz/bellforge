// invariantGE — the AMM constant-product check x'·y' ≥ x·y composed END-TO-END (two mulN products verified in place + cmpGEVerify,
// no alt plumbing). GREEN proves a k-preserving/growing swap passes and a k-DECREASING swap HALTs. This is the value-conservation
// keystone's math layer (GATE 12): the products are mulN-VERIFIED (not free witnesses), and the ≥ binds them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './scriptsim.mjs';
import { invariantGEOps, invariantGEWitness } from './mulGadget.mjs';

const limbs16 = (a, na) => { const o = []; let x = BigInt(a); for (let i = 0; i < na; i++) { o.push(Number(x & 0xffffn)); x >>= 16n; } return o; };
const limbs8 = (b, nb) => { const o = []; let x = BigInt(b); for (let j = 0; j < nb; j++) { o.push(Number(x & 0xffn)); x >>= 8n; } return o; };
const NA = 4, NB = 8;
const { ops } = invariantGEOps(NA, NB);
const W = (x, y, xp, yp) => invariantGEWitness({ Aold: limbs16(x, NA), Bold: limbs8(y, NB), Anew: limbs16(xp, NA), Bnew: limbs8(yp, NB) });
const run = (x, y, xp, yp) => () => runScript(ops, W(x, y, xp, yp));

test('invariantGE — x\'·y\' ≥ x·y passes (equal k, grown k)', () => {
  assert.doesNotThrow(run(100n, 100n, 50n, 200n), '10000 == 10000');
  assert.doesNotThrow(run(100n, 100n, 50n, 201n), '10050 > 10000');
  assert.doesNotThrow(run(1_000_000n, 1_000_000n, 2_000_000n, 500_001n), 'grown');
  assert.doesNotThrow(run(1n << 32n, 1n << 32n, 1n << 33n, 1n << 31n), '2^64 == 2^64 (max width)');
});

test('invariantGE RED — a k-DECREASING swap HALTs at the ≥', () => {
  assert.throws(run(100n, 100n, 50n, 199n), /VERIFY/, '9950 < 10000 must HALT');
  assert.throws(run(1_000_000n, 1_000_000n, 999_999n, 999_999n), /VERIFY/, 'k shrank (999998000001 < 10^12) must HALT');
});

test('invariantGE — BUDGET (uint64 reserves)', () => {
  const meta = invariantGEOps(NA, NB);
  const r = runScript(ops, W(100n, 100n, 50n, 200n));
  console.log(`\n  [invariantGE u64 budget] ops=${meta.ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}  witnessItems=${meta.totalDepth}  productLimbs=${meta.nr}`);
  assert.ok(r.peakStack < 1000);
});
