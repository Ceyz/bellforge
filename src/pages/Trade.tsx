import { PageHeader } from '../components/app/PageHeader'

function TokenInput({ side, token }: { side: string; token: string }) {
  return (
    <div className="rounded-btn border border-ink-600 bg-ink-900 p-4">
      <div className="mb-1 text-xs text-text-lo">{side}</div>
      <div className="flex items-center justify-between gap-3">
        <input className="w-1/2 bg-transparent text-lg text-text-hi outline-none placeholder:text-text-lo" placeholder="0.0" inputMode="decimal" />
        <span className="rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600">{token}</span>
      </div>
    </div>
  )
}

export function Trade() {
  return (
    <>
      <PageHeader
        title="Trade"
        subtitle="Swap $BELLS, $BOUND and any OP_CAT token via signed PSBT atomic orders — no custody, no AMM trust."
        status="soon"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-6">
          <TokenInput side="From" token="$BELLS" />
          <div className="flex justify-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-forge-400 ring-1 ring-ink-600">↓</span>
          </div>
          <TokenInput side="To" token="$BOUND" />
          <button type="button" disabled className="w-full cursor-not-allowed rounded-btn bg-ink-700 px-5 py-3 text-sm font-semibold text-text-lo">
            Swap — opens at mainnet
          </button>
        </div>
        <div className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
          <h3 className="font-display text-text-hi">Order book</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-mid">
            Peer-to-peer atomic-swap orders list here. It needs no new opcodes, so it works the day $BOUND
            is live — the first DEX surface on Bellforge.
          </p>
          <div className="mt-5 space-y-2 opacity-40">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between rounded-btn bg-ink-900 px-4 py-2.5 font-mono text-xs text-text-mid">
                <span>—</span>
                <span>—</span>
                <span>—</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
