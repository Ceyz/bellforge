// LP shares + token launch — the indexer's re-derivation of add/remove-liquidity + token launch (mint/burn the pool's own LP
// supply class). GREEN: launch → add → burn round-trips. REDs: over-burn, dust-burn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizeAddLiquidity, recognizeRemoveLiquidity, recognizeTokenLaunch, isqrt } from './poolPredicates.mjs';
import { runScript } from '../scriptsim.mjs';
import { lpBurnVerifyOps, lpBurnWitness } from '../mulGadget.mjs';

test('recognizeTokenLaunch — a launched token seeds a pool + mints the founder LP', () => {
  const r = recognizeTokenLaunch({ tokenId: Buffer.alloc(32, 7), supply: 1_000_000n, x0: 1000n, y0: 40_000_000n, founder: 'op' });
  assert.equal(r.pool.x, 1000n); assert.equal(r.pool.y, 40_000_000n);
  assert.equal(r.founderLp, isqrt(1000n * 40_000_000n));   // √(x0·y0)
  assert.equal(r.pool.lpTotal, r.founderLp);
});

test('add then burn round-trips pro-rata (the LP can get their funds back)', () => {
  let { pool } = recognizeTokenLaunch({ tokenId: Buffer.alloc(32, 7), supply: 1n, x0: 1000n, y0: 40_000_000n });
  // a 2nd LP adds the SAME ratio (doubles the pool) ⟹ mints ~= the founder's shares
  const add = recognizeAddLiquidity({ pool, dx: 1000n, dy: 40_000_000n });
  pool = add.pool;
  assert.equal(pool.x, 2000n); assert.equal(pool.y, 80_000_000n);
  // the 2nd LP burns ALL their minted shares ⟹ gets back ~their deposit
  const rem = recognizeRemoveLiquidity({ pool, lpBurn: add.lpMinted });
  assert.ok(rem.withdrawnX <= 1000n && rem.withdrawnX >= 999n, `withdrew ~1000 token, got ${rem.withdrawnX}`);
  assert.ok(rem.withdrawnY <= 40_000_000n && rem.withdrawnY >= 39_900_000n, `withdrew ~40M BELLS, got ${rem.withdrawnY}`);
  assert.equal(rem.pool.lpTotal, pool.lpTotal - add.lpMinted);
});

test('recognizeRemoveLiquidity RED — burning more than the total LP HALTs', () => {
  const { pool } = recognizeTokenLaunch({ tokenId: Buffer.alloc(32, 7), supply: 1n, x0: 1000n, y0: 40_000_000n });
  assert.throws(() => recognizeRemoveLiquidity({ pool, lpBurn: pool.lpTotal + 1n }), /burn.*> total LP/);
});

test('lpBurnVerify (on-stack) — the burn withdrawal is pro-rata-bounded (s·reserve ≥ withdraw·lpTotal)', () => {
  const { ops } = lpBurnVerifyOps(4, 8);
  // pool: reserve X=2000, lpTotal=100 ; burner s=50 ⟹ may withdraw ≤ 50·2000/100 = 1000.
  assert.doesNotThrow(() => runScript(ops, lpBurnWitness({ withdraw: 1000n, lpTotal: 100n, sBurn: 50n, reserve: 2000n })), 'withdraw=1000 is exactly pro-rata');
  assert.throws(() => runScript(ops, lpBurnWitness({ withdraw: 1001n, lpTotal: 100n, sBurn: 50n, reserve: 2000n })), /VERIFY/, 'over-withdraw (1001 > pro-rata 1000) must HALT');
});
