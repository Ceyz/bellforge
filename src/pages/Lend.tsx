import { PageHeader } from '../components/app/PageHeader'

export function Lend() {
  return (
    <>
      <PageHeader
        title="Lend"
        subtitle="Borrow against $BELLS or token collateral — native covenant composition, not an indexer-trusted ledger."
        status="rnd"
      />
      <div className="rounded-card border border-ink-600 bg-ink-800/60 p-8">
        <h3 className="font-display text-lg text-text-hi">Collateral the covenant enforces</h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-mid">
          Lock $BELLS or an OP_CAT token as collateral and borrow against it, with liquidation rules
          enforced by the coin’s own script — not a ledger that could be gamed off-chain.
        </p>
        <p className="mt-4 text-xs text-text-lo">
          R&D — the deepest surface; it composes the minter, transfers and pools. Comes after mainnet.
        </p>
        <button type="button" disabled className="mt-6 cursor-not-allowed rounded-btn bg-ink-700 px-5 py-3 text-sm font-semibold text-text-lo">
          Open a position — in research
        </button>
      </div>
    </>
  )
}
