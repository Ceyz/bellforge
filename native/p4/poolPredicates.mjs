// P4 indexer — AMM pool predicates (GATE 14: the indexer must track pool reserves + recognize swaps, beyond the one-genesis/one-
// supply base-token model). The indexer is the deterministic 2nd validator: it re-derives each swap off-chain (mirroring the leaf's
// consensus check) and updates the served pool state. A pool note is a NEW supply class — its own identity (pool_id) + mutable
// reserves (x = token amount, y = BELLS = the note's satoshi value), distinct from the base-token AMOUNT_0 conservation.
//
// recognizePoolSwap — given the pool's OLD reserves (x, y) read from the indexer state + the NEW reserves (x', y') read from the
// swap tx (y' = output[0].value, x' = the pool stateOut amount revealed in the spend witness) + the swap direction & token flow,
// VERIFY the swap (invariant x'·y' ≥ x·y + the directional conservation) and return the new pool state + the trader's deltas.
// Throws (HALT, like the consensus leaf) on any invalid swap — the indexer must never silently accept a state the leaf would reject.

export function recognizePoolSwap({ x, y, xp, yp, direction, tokenFlow }) {
  const X = BigInt(x), Y = BigInt(y), XP = BigInt(xp), YP = BigInt(yp), F = BigInt(tokenFlow);
  const U64 = (1n << 64n) - 1n;
  if (XP < 0n || YP < 0n || XP > U64 || YP > U64) throw new Error(`pool reserve out of uint64 range: x'=${XP} y'=${YP}`);
  if (F < 0n) throw new Error(`negative token flow ${F}`);
  // INVARIANT (the value half): x'·y' ≥ x·y — the constant product cannot decrease (fees make it grow). uint128, exact.
  if (XP * YP < X * Y) throw new Error(`invariant violated: x'·y'=${XP * YP} < x·y=${X * Y}`);
  // CONSERVATION (the token half): BUY ⟹ x == x' + tokenOut (pool token DOWN by F) ; SELL ⟹ x' == x + d (pool token UP by F).
  if (direction === 'buy') {
    if (X !== XP + F) throw new Error(`buy conservation: x=${X} != x'+tokenOut=${XP + F}`);
    if (YP <= Y) throw new Error('buy must add BELLS (y\' > y)');
  } else if (direction === 'sell') {
    if (XP !== X + F) throw new Error(`sell conservation: x'=${XP} != x+d=${X + F}`);
    if (YP >= Y) throw new Error('sell must remove BELLS (y\' < y)');
  } else {
    throw new Error(`unknown swap direction ${direction}`);
  }
  return {
    newX: XP, newY: YP,                                  // the updated pool reserves the indexer now serves
    traderTokenDelta: direction === 'buy' ? F : -F,      // + = trader received token (buy), − = trader deposited (sell)
    traderBellsDelta: direction === 'buy' ? -(YP - Y) : (Y - YP),  // BELLS the trader paid (buy) / received (sell)
    kBefore: X * Y, kAfter: XP * YP,                     // the constant product (audit: kAfter ≥ kBefore)
  };
}

// recognizePoolGenesis — a pool is CREATED (the indexer registers a new pool_id with its initial reserves). This is the
// multi-supply hook GATE 14 needs: each pool is its own supply class, NOT a 2nd base-token genesis (which the base indexer HALTs).
export function recognizePoolGenesis({ poolId, x0, y0, feeBps = 0 }) {
  const X0 = BigInt(x0), Y0 = BigInt(y0);
  if (X0 <= 0n || Y0 <= 0n) throw new Error('pool genesis needs positive initial reserves');
  if (!poolId || poolId.length !== 32) throw new Error('pool_id must be 32 bytes');
  return { poolId, x: X0, y: Y0, feeBps, k0: X0 * Y0 };
}

// ----- LP shares + token launch (the multi-supply DeFi the indexer must track: a pool's LP token is ITS OWN supply class) -----

// integer sqrt (for the first LP mint = √(x·y), Uniswap-v2). Exact floor.
export function isqrt(n) { const N = BigInt(n); if (N < 0n) throw new Error('isqrt of negative'); if (N < 2n) return N; let x = N, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + N / x) / 2n; } return x; }

// recognizeAddLiquidity — an LP deposits (dx, dy); mints LP shares. First mint = √(dx·dy); later = min(dx·T/x, dy·T/y) (the
// deposit must be balanced at the pool ratio, else the LP donates the excess — floored toward the pool). The LP-share supply
// `lpTotal` is the pool's OWN fungible supply class (mint here, BURN in recognizeRemoveLiquidity).
export function recognizeAddLiquidity({ pool, dx, dy }) {
  const X = BigInt(pool.x), Y = BigInt(pool.y), DX = BigInt(dx), DY = BigInt(dy), T = BigInt(pool.lpTotal ?? 0n);
  if (DX <= 0n || DY <= 0n) throw new Error('add liquidity needs positive dx, dy');
  let minted;
  if (T === 0n) { minted = isqrt(DX * DY); if (minted <= 0n) throw new Error('insufficient initial liquidity'); }
  else { const sx = (DX * T) / X, sy = (DY * T) / Y; minted = sx < sy ? sx : sy; if (minted <= 0n) throw new Error('insufficient liquidity minted'); }
  return { lpMinted: minted, pool: { ...pool, x: X + DX, y: Y + DY, lpTotal: T + minted } };
}

// recognizeRemoveLiquidity — an LP BURNS `lpBurn` shares; withdraws (dx, dy) PRO-RATA (floored toward the pool, so the remaining
// LPs are never diluted). This is the "burn the LP" the protocol needs for withdrawable liquidity (else the pool is a roach motel).
export function recognizeRemoveLiquidity({ pool, lpBurn }) {
  const X = BigInt(pool.x), Y = BigInt(pool.y), T = BigInt(pool.lpTotal), S = BigInt(lpBurn);
  if (S <= 0n) throw new Error('burn must be positive');
  if (S > T) throw new Error(`burn ${S} > total LP ${T}`);
  const dx = (S * X) / T, dy = (S * Y) / T;              // pro-rata, ⌊·⌋ — the burned share returns at most its fraction
  if (dx <= 0n || dy <= 0n) throw new Error('burn too small — yields zero');
  return { withdrawnX: dx, withdrawnY: dy, lpBurned: S, pool: { ...pool, x: X - dx, y: Y - dy, lpTotal: T - S } };
}

// recognizeTokenLaunch — anyone LAUNCHES a token (its own genesis/supply) + seeds an initial pool with (x0, y0); the founder gets
// the initial LP shares. Each launched token + its pool is an independent supply class (the per-token covenant model).
export function recognizeTokenLaunch({ tokenId, supply, x0, y0, founder }) {
  const SUP = BigInt(supply);
  if (SUP <= 0n) throw new Error('supply must be positive');
  if (!tokenId || tokenId.length !== 32) throw new Error('tokenId must be 32 bytes');
  const seeded = recognizeAddLiquidity({ pool: { poolId: tokenId, x: 0n, y: 0n, lpTotal: 0n }, dx: x0, dy: y0 });
  return { token: { tokenId, supply: SUP, founder }, pool: { ...seeded.pool, poolId: tokenId }, founderLp: seeded.lpMinted };
}

// ----- indexer INTEGRATION: recognize a swap tx + apply it to the tracked pool state (the tx-parsing / fixpoint layer) -----

// isPoolSwapShape — a swap tx self-replicates the pool note at output[0] (same poolSPK) with a pool stateOut at output[1].
export function isPoolSwapShape(tx, poolSPK) {
  return tx.outs && tx.outs.length >= 4 && Buffer.from(tx.outs[0].script).equals(Buffer.from(poolSPK));
}

// applyPoolSwap — read the NEW reserves from the swap tx (y' = output[0].value; x' = the pool stateOut amount, revealed in the
// spend witness and supplied as `newX` by the caller's witness-parser), infer the direction, re-derive via recognizePoolSwap, and
// return the updated pool. Determinism: the indexer reads y' from the tx and x' from the witness — both consensus-bound by the
// leaf — so two indexers compute the same new state. HALTs on exactly what the leaf rejects (invariant/conservation).
export function applyPoolSwap({ pool, tx, newX }) {
  if (!isPoolSwapShape(tx, pool.poolSPK)) throw new Error('not a pool-swap shape (output[0] != poolSPK)');
  const x = BigInt(pool.x), y = BigInt(pool.y);
  const yp = BigInt(tx.outs[0].value);                   // new pool BELLS reserve (output[0].value, c6-bound)
  const xp = BigInt(newX);                               // new pool token reserve (the pool stateOut amount, witness-revealed)
  const direction = yp > y ? 'buy' : 'sell';
  const tokenFlow = direction === 'buy' ? (x - xp) : (xp - x);   // BUY: tokenOut = x−x' ; SELL: deposit d = x'−x
  const res = recognizePoolSwap({ x, y, xp, yp, direction, tokenFlow });
  return { ...res, pool: { ...pool, x: res.newX, y: res.newY } };
}
