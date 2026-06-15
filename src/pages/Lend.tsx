import { PageHeader } from '../components/app/PageHeader'
import { Crucible } from '../components/juice/Crucible'

export function Lend() {
  return (
    <>
      <PageHeader
        title="Lend"
        subtitle="Borrow against $BELLS or token collateral — native covenant composition, not an indexer-trusted ledger."
        status="rnd"
      />
      <div className="grid gap-8 rounded-card border border-ink-600 bg-ink-800/60 p-8 md:grid-cols-[200px_1fr] md:items-center">
        <Crucible size={170} copy={<span className="font-micro text-[10px] tracking-[0.14em] text-forge-400">DEEPEST IN THE FORGE</span>} />
        <div>
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
      </div>
    </>
  )
}
