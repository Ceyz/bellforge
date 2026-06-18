// P4 lending predicates — the indexer's deterministic re-derivation of borrow / repay / liquidate. GREEN: valid ops. REDs:
// under-collateralized borrow, insufficient repayment, and liquidating a healthy position all HALT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizeLendingBorrow, recognizeLendingRepay, recognizeLendingLiquidate } from './lendingPredicates.mjs';

test('recognizeLendingBorrow — an over-collateralized borrow opens a position', () => {
  const r = recognizeLendingBorrow({ collateral: 1000n, loan: 700n, ltvBps: 7500 });
  assert.equal(r.position.debt, 700n); assert.equal(r.position.collateral, 1000n);
  assert.ok(r.healthBps >= 10000n, 'health ≥ 100%');
});

test('recognizeLendingBorrow RED — an under-collateralized borrow HALTs', () => {
  assert.throws(() => recognizeLendingBorrow({ collateral: 1000n, loan: 800n, ltvBps: 7500 }), /under-collateralized/);
});

test('recognizeLendingRepay — repayment covers principal + interest, releases collateral', () => {
  const pos = recognizeLendingBorrow({ collateral: 1000n, loan: 700n, ltvBps: 7500 }).position;
  const r = recognizeLendingRepay({ position: pos, repayment: 770n, rateBps: 1000 });   // 10% interest = 70 ⟹ owed 770
  assert.equal(r.interestPaid, 70n); assert.equal(r.released, 1000n); assert.equal(r.surplus, 0n);
  assert.throws(() => recognizeLendingRepay({ position: pos, repayment: 769n, rateBps: 1000 }), /repayment.*owed/);
});

test('recognizeLendingLiquidate — an underwater position is liquidatable, a healthy one is not', () => {
  const pos = { collateral: 1000n, debt: 700n, ltvBps: 7500n };
  const r = recognizeLendingLiquidate({ position: pos, collValueBells: 900n });           // 900·7500=6.75M < 700·10000=7M
  assert.equal(r.seizedCollateral, 1000n); assert.equal(r.debtCleared, 700n);
  assert.throws(() => recognizeLendingLiquidate({ position: pos, collValueBells: 950n }), /healthy/);  // 950·7500=7.125M ≥ 7M
});
