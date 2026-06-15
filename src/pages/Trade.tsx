import { useState } from 'react'
import { PageHeader } from '../components/app/PageHeader'
import { RouteSelector } from '../components/app/RouteSelector'

/* Illustrative book — clearly labelled a preview. No real market exists pre-mainnet. */
const ASKS = [
  { p: 0.00485, s: 1200 },
  { p: 0.00472, s: 840 },
  { p: 0.00461, s: 2100 },
  { p: 0.00455, s: 560 },
  { p: 0.0045, s: 1500 },
]
const BIDS = [
  { p: 0.00444, s: 980 },
  { p: 0.00438, s: 1700 },
  { p: 0.00431, s: 620 },
  { p: 0.0042, s: 2400 },
  { p: 0.00412, s: 1100 },
]
const MAX = Math.max(...ASKS.map((o) => o.s), ...BIDS.map((o) => o.s))

const inputCls =
  'w-full bg-transparent text-lg text-text-hi outline-none placeholder:text-text-lo'

function OrderRow({ p, s, side }: { p: number; s: number; side: 'ask' | 'bid' }) {
  const color = side === 'ask' ? 'text-red-400' : 'text-emerald-400'
  const bar = side === 'ask' ? 'bg-red-500/10' : 'bg-emerald-500/10'
  return (
    <div className="relative grid grid-cols-3 px-3 py-1 font-mono text-xs">
      <div className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${(s / MAX) * 100}%` }} />
      <span className={`relative ${color}`}>{p.toFixed(5)}</span>
      <span className="relative text-right text-text-mid">{s.toLocaleString()}</span>
      <span className="relative text-right text-text-lo">{(p * s).toFixed(2)}</span>
    </div>
  )
}

function Chart() {
  // Illustrative line — a calm shape, explicitly not real price data.
  const pts = [8, 14, 11, 18, 16, 22, 19, 26, 24, 30, 28, 33]
  const w = 100
  const h = 40
  const step = w / (pts.length - 1)
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const y = (v: number) => h - ((v - min) / (max - min)) * (h - 6) - 3
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${y(v)}`).join(' ')
  const area = `${line} L ${w} ${h} L 0 ${h} Z`
  return (
    <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-text-hi">$BOUND / $BELLS</span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">ILLUSTRATIVE · NO LIVE MARKET</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full">
        <defs>
          <linearGradient id="ch" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-forge-500)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--color-forge-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ch)" />
        <path d={line} fill="none" stroke="var(--color-forge-400)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

export function Trade() {
  const [mode, setMode] = useState<'market' | 'limit'>('market')
  const [amt, setAmt] = useState('')
  return (
    <>
      <PageHeader
        title="Trade"
        subtitle="Swap $BELLS, $BOUND and any OP_CAT token via signed PSBT atomic orders — no custody, no AMM trust."
        status="soon"
      />

      <div className="mb-5 rounded-card border border-forge-500/25 bg-forge-500/[0.06] px-4 py-3 text-center text-xs text-text-mid">
        Interface preview — the order book opens at mainnet. The numbers below are{' '}
        <span className="text-text-hi">illustrative</span>, not live orders.
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Chart />

          <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
            <h3 className="font-display text-text-hi">Order book</h3>
            <div className="mt-3 grid grid-cols-3 px-3 pb-1 font-micro text-[10px] uppercase tracking-wide text-text-lo">
              <span>Price ($BELLS)</span>
              <span className="text-right">Size ($BOUND)</span>
              <span className="text-right">Total</span>
            </div>
            <div className="space-y-px">
              {ASKS.map((o) => <OrderRow key={`a${o.p}`} {...o} side="ask" />)}
            </div>
            <div className="my-1.5 flex items-center justify-between border-y border-ink-600 px-3 py-1.5 text-xs">
              <span className="font-mono text-text-hi">0.00450</span>
              <span className="font-micro text-[10px] tracking-wide text-text-lo">SPREAD 1.3%</span>
            </div>
            <div className="space-y-px">
              {BIDS.map((o) => <OrderRow key={`b${o.p}`} {...o} side="bid" />)}
            </div>
          </div>
        </div>

        <div className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-5">
          <div className="flex rounded-btn bg-ink-900 p-1 text-sm">
            {(['market', 'limit'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-btn px-3 py-1.5 font-medium capitalize transition ${
                  mode === m ? 'bg-ink-700 text-text-hi' : 'text-text-mid hover:text-text-hi'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="rounded-btn border border-ink-600 bg-ink-900 p-4">
            <div className="mb-1 text-xs text-text-lo">You pay</div>
            <div className="flex items-center justify-between gap-3">
              <input value={amt} onChange={(e) => setAmt(e.target.value)} className={inputCls} placeholder="0.0" inputMode="decimal" />
              <span className="rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600">$BELLS</span>
            </div>
          </div>

          {mode === 'limit' && (
            <div className="rounded-btn border border-ink-600 bg-ink-900 p-4">
              <div className="mb-1 text-xs text-text-lo">Limit price ($BELLS)</div>
              <input className={`${inputCls} text-base`} placeholder="0.00450" inputMode="decimal" />
            </div>
          )}

          <div className="flex justify-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-forge-400 ring-1 ring-ink-600">↓</span>
          </div>

          <div className="rounded-btn border border-ink-600 bg-ink-900 p-4">
            <div className="mb-1 text-xs text-text-lo">You receive</div>
            <div className="flex items-center justify-between gap-3">
              <input className={inputCls} placeholder="0.0" inputMode="decimal" />
              <span className="rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600">$BOUND</span>
            </div>
          </div>

          <RouteSelector amountIn={Number(amt) || 0} />

          <button type="button" disabled className="w-full cursor-not-allowed rounded-btn bg-ink-700 px-5 py-3 text-sm font-semibold text-text-lo">
            {mode === 'market' ? 'Swap' : 'Place order'} — opens at mainnet
          </button>
          <p className="text-center text-xs text-text-lo">
            Orders are peer-to-peer signed PSBTs — no custody, no AMM. The book needs no new opcodes, so it
            ships the day $BOUND is live.
          </p>
        </div>
      </div>
    </>
  )
}
