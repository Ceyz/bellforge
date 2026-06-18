// P4 indexer — LENDING predicates (the 2nd DeFi primitive). A lending pool lends BELLS against token collateral; a borrow opens a
// debt POSITION (collateral C, debt B), bounded by a loan-to-value LTV; repayment covers principal + interest (= B·rate); under-
// water positions are liquidatable. The indexer deterministically re-derives each op (mirrors the on-stack consensus check: the
// LTV bound reuses the `invariantGE` two-product `≥`, the interest reuses `divN`). All arithmetic is exact BigInt — no rounding
// that favors the borrower (every rounding floors interest-owed-by-borrower's advantage away, i.e. owed rounds toward the pool).

// recognizeLendingBorrow — verify over-collateralization B·10000 ≤ C·ltvBps (B ≤ C·LTV) and open the position.
export function recognizeLendingBorrow({ collateral, loan, ltvBps }) {
  const C = BigInt(collateral), B = BigInt(loan), LTV = BigInt(ltvBps);
  if (B <= 0n) throw new Error('loan must be positive');
  if (C <= 0n) throw new Error('collateral must be positive');
  if (LTV <= 0n || LTV > 10000n) throw new Error(`ltvBps out of (0,10000]: ${LTV}`);
  if (B * 10000n > C * LTV) throw new Error(`under-collateralized: B·10000=${B * 10000n} > C·LTV=${C * LTV}`);
  return { position: { collateral: C, debt: B, ltvBps: LTV }, healthBps: (C * LTV) / B };  // healthBps ≥ 10000 ⟺ solvent
}

// recognizeLendingRepay — verify the repayment covers principal + interest (interest = ⌊B·rateBps/10000⌋, rounded toward the pool)
// and release the collateral.
export function recognizeLendingRepay({ position, repayment, rateBps }) {
  const C = BigInt(position.collateral), B = BigInt(position.debt), R = BigInt(repayment), RATE = BigInt(rateBps);
  if (RATE < 0n) throw new Error('negative rate');
  const interest = (B * RATE + 9999n) / 10000n;          // ⌈·⌉ — round interest UP, i.e. TOWARD THE POOL (audit fix: ⌊·⌋ favoured the borrower)
  const owed = B + interest;
  if (R < owed) throw new Error(`repayment ${R} < owed ${owed} (principal ${B} + interest ${interest})`);
  return { released: C, interestPaid: interest, surplus: R - owed };
}

// recognizeLendingLiquidate — a position is liquidatable when its CURRENT collateral value (at the pool/oracle price) no longer
// covers the debt at the LTV: collValueBells·ltvBps < debt·10000. The liquidator repays the debt and seizes the collateral.
export function recognizeLendingLiquidate({ position, collValueBells }) {
  const B = BigInt(position.debt), LTV = BigInt(position.ltvBps), V = BigInt(collValueBells);
  if (V * LTV >= B * 10000n) throw new Error(`position is healthy (V·LTV=${V * LTV} ≥ debt·10000=${B * 10000n}) — not liquidatable`);
  return { seizedCollateral: BigInt(position.collateral), debtCleared: B };
}
