// P4e — the REPLAY INVARIANT (the off-chain verifyGuardTokenAmount). Re-derive Σ(live bound amounts) + the burned supply and
// assert they sum to the operator-set genesis supply, with exactly one mint. v1 is full-amount mono-in/mono-out (ONE live note of
// AMOUNT_0, burnedSupply=0). v2 (TIER-FULL) divides the supply across many live notes AND may BURN part of it (terminal, supply-
// removed) — so the conserved quantity is Σ(live) + burnedSupply, NOT Σ(live) alone (which legitimately drops below AMOUNT_0 after
// the first burn — the v1 check would FALSE-HALT every post-burn ledger). A mismatch ⟹ HALT (an off-chain bug; the on-chain covenant
// already prevents inflation, P4e is the 2nd line that DETECTS a divergence). It does NOT bound the operator's chosen AMOUNT_0.
export function replayInvariant(ix) {
  let sigma = 0n;
  for (const n of ix.liveNotes.values()) sigma += n.amount;
  const burned = ix.burnedSupply || 0n;
  const ok = ix.mintCount === 1 && (sigma + burned) === ix.deploy.AMOUNT_0;
  if (!ok) throw new Error(`HALT replay invariant: Σ(live)=${sigma} + burned=${burned} (want AMOUNT_0=${ix.deploy.AMOUNT_0}), mintCount=${ix.mintCount} (want 1)`);
  return { sigma, burned, mintCount: ix.mintCount };
}
