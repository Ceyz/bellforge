import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'
import { Reveal } from '../components/ui/Reveal'
import { HonestBanner } from '../components/ui/HonestBanner'
import { HonestFooter } from '../components/ui/HonestFooter'
import { SectionLabel } from '../components/ui/SectionLabel'
import { Disclosure } from '../components/juice/Disclosure'
import { ForgeButton } from '../components/juice/ForgeButton'
import { Crucible } from '../components/juice/Crucible'
import { useWallet } from '../wallet/WalletProvider'
import { ConnectWallet } from '../components/app/ConnectWallet'

const inputCls =
  'input-forge w-full rounded-btn border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-text-hi placeholder:text-text-lo'
const labelCls = 'mb-1.5 block text-xs font-medium text-text-mid'

/** Collateral options. `maxLtv` = collateral factor, `liq` = liquidation
    threshold — both ILLUSTRATIVE placeholders, set per market at launch. They are
    used only to demonstrate the LTV / health-factor mechanic against the user's
    own input; nothing here is a live or final parameter. */
const COLLATERAL = [
  { sym: '$BELLS', id: 'bells', maxLtv: 0.75, liq: 0.85 },
  { sym: '$BOUND', id: 'bound', maxLtv: 0.5, liq: 0.65 },
] as const

type Collateral = (typeof COLLATERAL)[number]

/** Colour band for a health factor. HF = liquidationThreshold / currentLTV, so
    HF→1 at liquidation. Unit-free (a ratio) → no fabricated cross-asset price. */
function hfTone(hf: number) {
  if (hf >= 2) return { text: 'text-pos', dot: 'bg-pos', word: 'Safe' }
  if (hf >= 1.4) return { text: 'text-bell-300', dot: 'bg-bell-400', word: 'Caution' }
  return { text: 'text-neg', dot: 'bg-neg', word: 'At risk' }
}

/** A zoned LTV track (safe / caution / liquidation) with a marker at the current
    LTV. Track spans 0…liq so the right edge IS liquidation. Pure ratios. */
function HealthMeter({ ltv, maxLtv, liq }: { ltv: number; maxLtv: number; liq: number }) {
  const pos = Math.max(0, Math.min(1, ltv / liq)) * 100
  const safeEnd = ((maxLtv * 0.66) / liq) * 100
  const cautionEnd = (maxLtv / liq) * 100
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-pill ring-1 ring-inset ring-ink-600">
        <div className="absolute inset-0 flex">
          <span style={{ width: `${safeEnd}%` }} className="bg-pos/40" />
          <span style={{ width: `${cautionEnd - safeEnd}%` }} className="bg-bell-400/45" />
          <span style={{ width: `${100 - cautionEnd}%` }} className="bg-neg/45" />
        </div>
        <span
          aria-hidden
          className="absolute top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-pill bg-text-hi shadow transition-[left] duration-300 ease-out"
          style={{ left: `calc(${pos}% - 3px)`, boxShadow: '0 0 8px rgba(255,210,74,0.8)' }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-micro text-[10px] tracking-wide text-text-lo">
        <span>0% LTV</span>
        <span>LIQUIDATION · {Math.round(liq * 100)}%</span>
      </div>
    </div>
  )
}

/** Cosmetic borrow preview. The collateral amount is free text (feel only); the
    LTV slider + health factor are computed as RATIOS against illustrative,
    clearly-labelled collateral factors — no price, no cross-asset value. */
function BorrowPreview() {
  const { address } = useWallet()
  const [colId, setColId] = useState<string>('bells')
  const col: Collateral = COLLATERAL.find((c) => c.id === colId) ?? COLLATERAL[0]
  const [amount, setAmount] = useState('')
  const [ltv, setLtv] = useState(0.3)

  // Keep the LTV within the selected collateral's factor when switching assets.
  const clampedLtv = Math.min(ltv, col.maxLtv)
  const hf = clampedLtv > 0 ? col.liq / clampedLtv : Infinity
  const tone = hfTone(hf)
  const capacityUsed = (clampedLtv / col.maxLtv) * 100

  function pickCollateral(id: string) {
    const next = COLLATERAL.find((c) => c.id === id) ?? COLLATERAL[0]
    setColId(id)
    if (ltv > next.maxLtv) setLtv(next.maxLtv)
  }

  return (
    <form className="space-y-5 rounded-card border border-ink-600 bg-ink-800/60 p-6" onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between">
        <SectionLabel>Open a position</SectionLabel>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">BORROW $BELLS</span>
      </div>

      <div>
        <label className={labelCls}>Collateral</label>
        <div className="flex flex-wrap gap-2">
          {COLLATERAL.map((c) => {
            const active = c.id === colId
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCollateral(c.id)}
                aria-pressed={active}
                className={`rounded-pill px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                  active ? 'bg-forge-500/15 text-forge-300 ring-forge-500/30' : 'text-text-mid ring-ink-600 hover:text-text-hi'
                }`}
              >
                {c.sym}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className={labelCls}>Collateral amount</label>
        <input className={inputCls} placeholder="0.0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className={labelCls + ' mb-0'}>Loan-to-value</label>
          <span className="font-mono text-sm text-text-hi">{Math.round(clampedLtv * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.round(col.maxLtv * 100)}
          step={1}
          value={Math.round(clampedLtv * 100)}
          onChange={(e) => setLtv(parseInt(e.target.value, 10) / 100)}
          className="slider-forge w-full"
          aria-label="Loan-to-value"
          aria-valuetext={`${Math.round(clampedLtv * 100)}% LTV — ${tone.word}, health factor ${hf === Infinity ? 'infinite' : hf.toFixed(2)}`}
        />
        <p className="mt-1 font-micro text-[10px] tracking-wide text-text-lo">
          MAX {Math.round(col.maxLtv * 100)}% · ILLUSTRATIVE COLLATERAL FACTOR
        </p>
      </div>

      <HealthMeter ltv={clampedLtv} maxLtv={col.maxLtv} liq={col.liq} />

      <dl className="grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-3">
        <div className="bg-ink-800 p-4">
          <dt className="text-xs text-text-lo">Health factor</dt>
          <dd className={`mt-0.5 flex items-center gap-1.5 font-mono text-lg ${tone.text}`}>
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            {hf === Infinity ? '∞' : hf.toFixed(2)}
          </dd>
          <dd className="mt-0.5 text-xs text-text-mid">{tone.word} · liquidates at 1.00</dd>
        </div>
        <div className="bg-ink-800 p-4">
          <dt className="text-xs text-text-lo">Capacity used</dt>
          <dd className="mt-0.5 font-mono text-lg text-text-hi">{Math.round(capacityUsed)}%</dd>
          <dd className="mt-0.5 text-xs text-text-mid">of the {Math.round(col.maxLtv * 100)}% factor</dd>
        </div>
        <div className="bg-ink-800 p-4">
          <dt className="text-xs text-text-lo">Liquidation at</dt>
          <dd className="mt-0.5 font-mono text-lg text-text-hi">{Math.round(col.liq * 100)}%</dd>
          <dd className="mt-0.5 text-xs text-text-mid">LTV · enforced in-script at launch</dd>
        </div>
      </dl>

      <div className="pt-1">
        {!address ? (
          <ConnectWallet className="w-full" />
        ) : (
          <ForgeButton idleLabel="Preview a borrow position" doneLabel="Position opened (preview)" />
        )}
        <p className="mt-2.5 text-center text-xs text-text-lo">
          A cosmetic preview — covenant lending goes live after the audit. No funds move; the figures above are
          ratios from your own input and an illustrative collateral factor.
        </p>
      </div>
    </form>
  )
}

function Guarantees() {
  return (
    <aside className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-6 text-sm text-text-mid">
      <Crucible size={96} copy={<span className="font-micro text-[10px] tracking-[0.14em] text-forge-400">THE SCRIPT HOLDS THE DEADBOLT</span>} />
      <h3 className="font-display text-text-hi">What the covenant enforces</h3>
      <ul className="space-y-2">
        <li>Collateral is locked in <span className="text-text-hi">the coin’s own script</span>, not an off-chain ledger.</li>
        <li>The liquidation rule lives in <span className="text-text-hi">tapscript</span> — no privileged keeper bot.</li>
        <li>A spend that breaks the loan terms is <span className="text-text-hi">invalid at consensus</span>.</li>
        <li>Every position is a covenant note anyone can verify from genesis.</li>
      </ul>
      <p className="border-t border-ink-600 pt-3 text-xs text-text-lo">
        This is the deepest surface — it composes the minter, transfers and pools. It comes after mainnet.
      </p>
    </aside>
  )
}

function HowItWorks() {
  const steps = [
    {
      t: 'Lock collateral',
      d: 'Your $BELLS or OP_CAT token moves into a covenant vault note. The lock — not a promise in a ledger — is what backs the loan.',
    },
    {
      t: 'Draw credit',
      d: 'Borrow up to the collateral factor. The covenant pins the debt to the locked note, so the two can only be released together.',
    },
    {
      t: 'Covenant enforces liquidation',
      d: 'If the CSFS-signed price crosses the threshold, the liquidation branch becomes spendable by anyone — no privileged liquidator.',
    },
  ]
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>How covenant lending works</SectionLabel>
      <ol className="mt-5 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.t} className="heat-card bg-ink-800 p-5">
            <span className="font-micro flex h-7 w-7 items-center justify-center rounded-pill bg-forge-500/15 text-xs text-forge-300 ring-1 ring-inset ring-forge-500/30">
              {i + 1}
            </span>
            <h3 className="font-display mt-3 text-sm text-text-hi">{s.t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-mid">{s.d}</p>
          </li>
        ))}
      </ol>
    </Reveal>
  )
}

function Rationale() {
  return (
    <div className="space-y-3">
      <Disclosure summary="Why covenant collateral beats an indexer-trusted ledger">
        When collateral is enforced by the coin’s own script, a transfer that would break the loan terms is simply
        invalid at consensus — there is nothing to “flag” after the fact. An off-chain ledger that merely tracks
        balances can be gamed the way the CAT20 over-mint was: by feeding the tracker a state it didn’t verify.
      </Disclosure>
      <Disclosure summary="Liquidation without a trusted keeper">
        The threshold check reads the same CSFS-signed oracle the pools use. The liquidation branch is a public
        covenant path: once the signed price crosses the line, any liquidator can take it. There is no privileged
        bot that could be bribed to delay — or front-run — a liquidation.
      </Disclosure>
      <Disclosure summary="What can be collateral">
        $BELLS natively, and any OP_CAT token such as $BOUND — because each is a covenant note the vault can hold
        and re-bind. Once pools ship, an LP position (itself a covenant note) becomes collateral too.
      </Disclosure>
      <Disclosure summary="How lending composes with the rest of Bellforge">
        Borrow $BELLS against $BOUND, route it into a{' '}
        <Link to="/app/pools" className="text-forge-400 hover:underline">
          pool
        </Link>
        , or back a new position — every leg settles on the same covenant substrate, so the whole stack composes
        on-chain instead of through a trusted intermediary.
      </Disclosure>
    </div>
  )
}

export function Lend() {
  return (
    <>
      <PageItem>
        <PageHeader
          title="Lend"
          subtitle="Borrow against $BELLS or an OP_CAT token — collateral and liquidation enforced by the coin’s own covenant, not an indexer-trusted ledger."
          status="rnd"
        />
      </PageItem>
      <PageItem className="space-y-6">
        <HonestBanner>
          Lending is in research. The panel below is a cosmetic preview — the health factor and LTV are ratios
          computed from your own input against an illustrative collateral factor. No funds move; covenant lending
          goes live after the audit.
        </HonestBanner>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <BorrowPreview />
          <Guarantees />
        </div>
        <HowItWorks />
        <Rationale />
        <HonestFooter>
          Honest disclosure: lending is <span className="text-text-mid">R&amp;D, shown on regtest with zero real value</span>.
          Collateral factors and liquidation thresholds here are illustrative placeholders, not final parameters —
          and no rate, APY or live position is shown, because none exist yet.
        </HonestFooter>
      </PageItem>
    </>
  )
}
