// P4 pool predicates — the indexer's deterministic re-derivation of AMM swaps (GATE 14: pool-state tracking + multi-supply).
// GREEN: valid buy/sell swaps update the pool + return the trader deltas. REDs: invariant or conservation violations HALT (the
// indexer rejects exactly what the consensus leaf rejects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizePoolSwap, recognizePoolGenesis, applyPoolSwap } from './poolPredicates.mjs';

test('recognizePoolSwap — a valid BUY updates the pool + trader deltas', () => {
  // pool 1000 token / 50M BELLS ; trader funds BELLS (→84M), gets 400 token (x:1000→600). k: 5e10 → 5.04e10.
  const r = recognizePoolSwap({ x: 1000n, y: 50_000_000n, xp: 600n, yp: 84_000_000n, direction: 'buy', tokenFlow: 400n });
  assert.equal(r.newX, 600n); assert.equal(r.newY, 84_000_000n);
  assert.equal(r.traderTokenDelta, 400n);             // trader received 400 token
  assert.equal(r.traderBellsDelta, -34_000_000n);     // trader paid 34M BELLS
  assert.ok(r.kAfter >= r.kBefore);
});

test('recognizePoolSwap — a valid SELL updates the pool + trader deltas', () => {
  // pool 600/84M ; trader deposits 400 token (x:600→1000), gets BELLS (y:84M→51M). k: 5.04e10 → 5.1e10.
  const r = recognizePoolSwap({ x: 600n, y: 84_000_000n, xp: 1000n, yp: 51_000_000n, direction: 'sell', tokenFlow: 400n });
  assert.equal(r.newX, 1000n); assert.equal(r.newY, 51_000_000n);
  assert.equal(r.traderTokenDelta, -400n);            // trader deposited 400 token
  assert.equal(r.traderBellsDelta, 33_000_000n);      // trader received 33M BELLS
  assert.ok(r.kAfter >= r.kBefore);
});

test('recognizePoolSwap RED — a k-decreasing swap is rejected (indexer mirrors consensus)', () => {
  assert.throws(() => recognizePoolSwap({ x: 1000n, y: 50_000_000n, xp: 600n, yp: 80_000_000n, direction: 'buy', tokenFlow: 400n }), /invariant violated/);
});

test('recognizePoolSwap RED — a non-conserving swap is rejected', () => {
  assert.throws(() => recognizePoolSwap({ x: 1000n, y: 50_000_000n, xp: 600n, yp: 84_000_000n, direction: 'buy', tokenFlow: 401n }), /buy conservation/);
  assert.throws(() => recognizePoolSwap({ x: 600n, y: 84_000_000n, xp: 1001n, yp: 51_000_000n, direction: 'sell', tokenFlow: 400n }), /sell conservation/);
});

test('recognizePoolSwap RED — wrong-direction BELLS flow is rejected', () => {
  assert.throws(() => recognizePoolSwap({ x: 1000n, y: 50_000_000n, xp: 600n, yp: 40_000_000n, direction: 'buy', tokenFlow: 400n }), /buy must add BELLS|invariant/);
});

test('recognizePoolGenesis — registers a new pool as its own supply class', () => {
  const g = recognizePoolGenesis({ poolId: Buffer.alloc(32, 1), x0: 1000n, y0: 50_000_000n, feeBps: 30 });
  assert.equal(g.x, 1000n); assert.equal(g.y, 50_000_000n); assert.equal(g.k0, 50_000_000_000n);
  assert.throws(() => recognizePoolGenesis({ poolId: Buffer.alloc(32, 1), x0: 0n, y0: 1n }), /positive initial reserves/);
});

// --- indexer integration: parse + apply a swap tx ---
const poolSPK = Buffer.alloc(34, 0x51);
const mockTx = (yp) => ({ outs: [{ value: yp, script: poolSPK }, { value: 0, script: Buffer.from([0x6a]) }, { value: 9000, script: Buffer.alloc(34, 0x33) }, { value: 1000, script: Buffer.alloc(34, 0x44) }] });

test('applyPoolSwap — a BUY tx updates the tracked pool (y up, x down)', () => {
  const r = applyPoolSwap({ pool: { poolSPK, x: 1000n, y: 50_000_000n }, tx: mockTx(84_000_000), newX: 600n });
  assert.equal(r.pool.x, 600n); assert.equal(r.pool.y, 84_000_000n); assert.equal(r.traderTokenDelta, 400n);
});

test('applyPoolSwap — a SELL tx updates the tracked pool (y down, x up)', () => {
  const r = applyPoolSwap({ pool: { poolSPK, x: 600n, y: 84_000_000n }, tx: mockTx(51_000_000), newX: 1000n });
  assert.equal(r.pool.x, 1000n); assert.equal(r.pool.y, 51_000_000n); assert.equal(r.traderTokenDelta, -400n);
});

test('applyPoolSwap RED — a non-pool-shape tx is rejected', () => {
  assert.throws(() => applyPoolSwap({ pool: { poolSPK, x: 1000n, y: 50_000_000n }, tx: { outs: [{ value: 1, script: Buffer.alloc(34, 0xff) }] }, newX: 600n }), /not a pool-swap shape/);
});
