import { PageHeader } from '../components/app/PageHeader'

export function Pools() {
  return (
    <>
      <PageHeader
        title="Pools"
        subtitle="Provide liquidity for any pair — CSFS-oracle pools on the covenant substrate."
        status="rnd"
      />
      <div className="rounded-card border border-ink-600 bg-ink-800/60 p-8">
        <h3 className="font-display text-lg text-text-hi">Quote-bound liquidity, on a covenant</h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-mid">
          Pools price against a CSFS oracle and settle on the same covenant substrate as transfers — no
          trusted sequencer holding funds. A trustless constant-product AMM is out of scope on Bellscoin
          (no OP_MUL), so pools are quote-bound and one-UTXO-per-block aware.
        </p>
        <p className="mt-4 text-xs text-text-lo">
          R&D — designed after the DEX order book ships. Building it here means it composes on-chain with
          $BELLS, $BOUND and any OP_CAT token.
        </p>
        <button type="button" disabled className="mt-6 cursor-not-allowed rounded-btn bg-ink-700 px-5 py-3 text-sm font-semibold text-text-lo">
          Provide liquidity — in research
        </button>
      </div>
    </>
  )
}
