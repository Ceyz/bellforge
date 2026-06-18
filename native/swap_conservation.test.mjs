// swapConservationOps — the token-side conservation of a pool update: x == x' + tokenOut (the pool's token decrease == the
// trader's receipt), single-sourced. GREEN: a conserving update passes. REDs: a non-conserving update (token minted/leaked), a
// num un-tied from its byte, and an overflow all HALT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { swapConservationOps, swapConservationWitness } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const { ops } = swapConservationOps();
const run = (x, xp, to) => () => runScript(ops, swapConservationWitness(x, xp, to));

test('swapConservation — x == x\' + tokenOut passes (token decrease == trader receipt)', () => {
  assert.doesNotThrow(run(1000n, 600n, 400n), '1000 = 600 + 400');
  assert.doesNotThrow(run(0n, 0n, 0n), '0 = 0 + 0');
  assert.doesNotThrow(run((1n << 64n) - 1n, 1n, (1n << 64n) - 2n), 'max with carries across all limbs');
  assert.doesNotThrow(run(0x10000n, 0xffffn, 1n), 'carry propagation 65536 = 65535 + 1');
});

test('swapConservation RED — token NOT conserved (x != x\' + tokenOut) HALTs', () => {
  assert.throws(run(1000n, 600n, 401n), /NUMEQUALVERIFY|VERIFY/, '1000 != 1001 must HALT (token minted)');
  assert.throws(run(1000n, 600n, 399n), /NUMEQUALVERIFY|VERIFY/, '1000 != 999 must HALT (token leaked)');
});

test('swapConservation RED — a num un-tied from its wire byte HALTs at the tie', () => {
  const w = swapConservationWitness(1000n, 600n, 400n);
  w[8] = enc((1000 & 0xff) ^ 1);                         // forge x_num[0] (abs 8) ≠ x_ser[0]
  assert.throws(() => runScript(ops, w), /EQUALVERIFY|WITHIN/, 'x_num != x_ser must HALT');
});

test('swapConservation — BUDGET', () => {
  const r = runScript(ops, swapConservationWitness(1000n, 600n, 400n));
  console.log(`\n  [swapConservation budget] ops=${ops.filter((x) => !Buffer.isBuffer(x)).length}  peakStack=${r.peakStack}`);
  assert.ok(r.peakStack < 1000);
});
