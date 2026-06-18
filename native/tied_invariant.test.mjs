// tiedInvariantGE — the brick-2 capstone: x'·y' ≥ x·y with all 4 operands SINGLE-SOURCED from their byte serializations.
// GREEN: a k-preserving/growing swap with consistent (serialization ↔ mulN operands) passes. REDs: k-decreasing HALTs; and a
// reserve serialization that does NOT match its mulN operand (the "free witness" attack) is REJECTED by the tie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { tiedInvariantGEOps, tiedInvariantGEWitness } from './mulGadget.mjs';

const B = (n) => Buffer.from([n]);
const meta = tiedInvariantGEOps(4, 8);
const { ops } = meta;
const W = (x, y, xp, yp) => tiedInvariantGEWitness({ x, y, xp, yp });
const run = (x, y, xp, yp) => () => runScript(ops, W(x, y, xp, yp));

test('tiedInvariantGE — single-sourced x\'·y\' ≥ x·y passes (equal/grown k)', () => {
  assert.doesNotThrow(run(100n, 100n, 50n, 200n), '10000 == 10000');
  assert.doesNotThrow(run(100n, 100n, 50n, 201n), '10050 > 10000');
  assert.doesNotThrow(run(1n << 40n, 1n << 40n, 1n << 41n, 1n << 39n), 'large, equal k');
});

test('tiedInvariantGE RED — a k-DECREASING swap HALTs at the ≥', () => {
  assert.throws(run(100n, 100n, 50n, 199n), /VERIFY/, '9950 < 10000 must HALT');
});

test('tiedInvariantGE RED — a reserve serialization NOT matching its mulN operand is rejected (no free-witness reserve)', () => {
  const w = W(100n, 100n, 50n, 200n);
  // x_ser[0] is at abs (2W + 0). x=100 ⟹ x_ser[0]=100; forge it to 101 while A_old (the mulN operand) still encodes 100.
  w[meta.xSer] = B(101);
  assert.throws(() => runScript(ops, w), /EQUALVERIFY|WITHIN/, 'x_ser != the tied A_old operand must HALT at the tie');
});

test('tiedInvariantGE — BUDGET (uint64, fully single-sourced)', () => {
  const r = runScript(ops, W(100n, 100n, 50n, 200n));
  console.log(`\n  [tiedInvariantGE u64 budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}  witnessItems=${meta.totalDepth}`);
  assert.ok(r.peakStack < 1000);
});

test('tiedInvariantGE — EMBEDDABLE at a non-zero base (glue piece 1 for the swap-leaf assembly)', () => {
  const localSize = tiedInvariantGEOps(4, 8).localSize;
  const offset = 5;                                       // 5 dummy items sit BELOW the tied region
  const dummy = Array.from({ length: offset }, (_, i) => Buffer.from([i + 1]));
  const embed = (x, y, xp, yp) => () => runScript(
    tiedInvariantGEOps(4, 8, { base: offset, startDepth: offset + localSize }).ops,
    [...dummy, ...tiedInvariantGEWitness({ x, y, xp, yp })],
  );
  assert.doesNotThrow(embed(100n, 100n, 50n, 200n), 'embedded @base=5 must pass (same as standalone)');
  assert.throws(embed(100n, 100n, 50n, 199n), /VERIFY/, 'embedded k-decreasing must still HALT');
});
