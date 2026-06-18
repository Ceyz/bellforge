// lendingBorrowVerify — the on-stack over-collateralization check (C·ltvNum ≥ B·scale), reusing invariantGE. GREEN: a borrow
// within the LTV passes. RED: a borrow exceeding the LTV HALTs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './scriptsim.mjs';
import { lendingBorrowVerifyOps, lendingBorrowWitness } from './mulGadget.mjs';

const { ops } = lendingBorrowVerifyOps(4, 8);
const run = (B, scale, C, ltvNum) => () => runScript(ops, lendingBorrowWitness({ B, scale, C, ltvNum }));

test('lendingBorrow — a borrow within LTV passes (C·ltvNum ≥ B·scale)', () => {
  assert.doesNotThrow(run(700n, 10000n, 1000n, 7500n), '700 ≤ 1000·0.75 = 750');
  assert.doesNotThrow(run(750n, 10000n, 1000n, 7500n), 'exactly at the 75% LTV');
});

test('lendingBorrow RED — a borrow exceeding the LTV HALTs', () => {
  assert.throws(run(800n, 10000n, 1000n, 7500n), /VERIFY/, '800 > 750 (the LTV bound) must HALT');
});
