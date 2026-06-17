import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'
import { Reveal } from '../components/ui/Reveal'
import { HonestBanner } from '../components/ui/HonestBanner'
import { HonestFooter } from '../components/ui/HonestFooter'
import { SectionLabel } from '../components/ui/SectionLabel'
import { StatusPill } from '../components/ui/StatusPill'
import { Disclosure } from '../components/juice/Disclosure'
import { ForgeButton } from '../components/juice/ForgeButton'
import { Crucible } from '../components/juice/Crucible'
import { useWallet } from '../wallet/WalletProvider'
import { ConnectWallet } from '../components/app/ConnectWallet'

const inputCls =
  'input-forge w-full rounded-btn border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-text-hi placeholder:text-text-lo'
const labelCls = 'mb-1.5 block text-xs font-medium text-text-mid'

/** Tokens that can be paired against $BELLS in a (future) covenant pool. */
const POOL_TOKENS = [
  { sym: '$BOUND', id: 'bound' },
  { sym: 'NINTONDO', id: 'nintondo' },
] as const

function TokenChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {POOL_TOKENS.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={`rounded-pill px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
              active ? 'bg-forge-500/15 text-forge-300 ring-forge-500/30' : 'text-text-mid ring-ink-600 hover:text-text-hi'
            }`}
          >
            {t.sym}
          </button>
        )
      })}
    </div>
  )
}

/** Cosmetic deposit preview. Every number shown is derived ONLY from what the user
    types (their own opening ratio) — no market data, no projection. */
function DepositPreview() {
  const { address } = useWallet()
  const [tok, setTok] = useState<string>('bound')
  const [tokAmt, setTokAmt] = useState('')
  const [bellsAmt, setBellsAmt] = useState('')
  const sym = POOL_TOKENS.find((t) => t.id === tok)?.sym ?? '$BOUND'
  const t = parseFloat(tokAmt)
  const b = parseFloat(bellsAmt)
  const rate = t > 0 && b > 0 ? b / t : null

  return (
    <form className="space-y-5 rounded-card border border-ink-600 bg-ink-800/60 p-6" onSubmit={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between">
        <SectionLabel>Provide liquidity</SectionLabel>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">PAIR · {sym} / $BELLS</span>
      </div>

      <div>
        <label className={labelCls}>Token to pair with $BELLS</label>
        <TokenChips value={tok} onChange={setTok} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>{sym} amount</label>
          <input className={inputCls} placeholder="0.0" inputMode="decimal" value={tokAmt} onChange={(e) => setTokAmt(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>$BELLS amount</label>
          <input className={inputCls} placeholder="0.0" inputMode="decimal" value={bellsAmt} onChange={(e) => setBellsAmt(e.target.value)} />
        </div>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        <div className="bg-ink-800 p-4">
          <dt className="text-xs text-text-lo">Your opening quote</dt>
          <dd className="mt-0.5 font-mono text-lg text-text-hi">
            {rate ? rate.toFixed(6) : '—'} <span className="text-xs text-text-mid">$BELLS / {sym}</span>
          </dd>
          <dd className="mt-0.5 text-xs text-text-mid">The first provider sets the pool’s starting price.</dd>
        </div>
        <div className="bg-ink-800 p-4">
          <dt className="text-xs text-text-lo">Initial pool share</dt>
          <dd className="mt-0.5 font-mono text-lg text-text-hi">100%</dd>
          <dd className="mt-0.5 text-xs text-text-mid">You’d be the sole LP until others join.</dd>
        </div>
      </dl>

      <div className="pt-1">
        {!address ? (
          <ConnectWallet className="w-full" />
        ) : (
          <ForgeButton idleLabel="Preview liquidity provision" doneLabel="Liquidity poured (preview)" />
        )}
        <p className="mt-2.5 text-center text-xs text-text-lo">
          A cosmetic preview — quote-bound pools go live after the covenant audit. Nothing here moves real funds.
        </p>
      </div>
    </form>
  )
}

function Guarantees() {
  return (
    <aside className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-6 text-sm text-text-mid">
      <Crucible size={96} copy={<span className="font-micro text-[10px] tracking-[0.14em] text-forge-400">QUOTE-BOUND · NO SEQUENCER</span>} />
      <h3 className="font-display text-text-hi">What the covenant guarantees</h3>
      <ul className="space-y-2">
        <li>Liquidity stays in a <span className="text-text-hi">covenant UTXO</span> — no sequencer ever custodies it.</li>
        <li>Swaps execute at a <span className="text-text-hi">CSFS-signed oracle quote</span> the script verifies.</li>
        <li>One spend per block — <span className="text-text-hi">no in-block sandwiching</span>.</li>
        <li>Value is conserved on-chain, exactly like every transfer.</li>
      </ul>
      <p className="border-t border-ink-600 pt-3 text-xs text-text-lo">
        A trustless x·y=k AMM needs OP_MUL, which Bellscoin doesn’t have — so pools are quote-bound by design.
      </p>
    </aside>
  )
}

function HowItWorks() {
  const steps = [
    {
      t: 'Alloy a pair',
      d: 'A token and $BELLS go into one covenant UTXO — the pool note. The first provider sets the opening price.',
    },
    {
      t: 'Oracle binds the quote',
      d: 'A CSFS-signed price feed sets the swap rate. There is no x·y=k curve — Bellscoin has no OP_MUL to enforce one in script.',
    },
    {
      t: 'Swaps settle on-covenant',
      d: 'One swap per block keeps MEV out; tapscript enforces conservation; LPs accrue the spread between quote and fills.',
    },
  ]
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>How a quote-bound pool works</SectionLabel>
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

function LivePools() {
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <div className="flex items-center justify-between">
        <SectionLabel>Live pools</SectionLabel>
        <StatusPill status="rnd" label="None yet" />
      </div>
      <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-sm leading-relaxed text-text-mid">
          No quote-bound pools are deployed yet. Until they ship, the live venue for swapping is the peer-to-peer
          order book on Trade — real offers, atomic settlement, no custody.
        </p>
        <Link
          to="/app/trade"
          className="ember-glow-host inline-flex shrink-0 items-center justify-center rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-lg shadow-forge-600/25 transition hover:brightness-110"
        >
          Trade on the order book →
        </Link>
      </div>
    </Reveal>
  )
}

function Rationale() {
  return (
    <div className="space-y-3">
      <Disclosure summary="Why not a constant-product (x·y=k) AMM?">
        OP_MUL is one of the opcodes Bellscoin treats as OP_SUCCESSx — it can’t be enforced in tapscript. A
        constant-product pool needs on-chain multiplication, so it can’t be made trustless here. Bellforge pools
        instead price against a CSFS-signed oracle the covenant verifies, and the script only checks that the
        executed rate matches the signed quote and that value is conserved.
      </Disclosure>
      <Disclosure summary="What is a CSFS-oracle pool?">
        OP_CHECKSIGFROMSTACK lets a covenant verify a price that a known key (or committee) signed off-chain —
        without trusting anyone to hold the funds. Liquidity never leaves the covenant; the oracle only signs a
        number, and the script rejects any swap that doesn’t honour the signed quote.
      </Disclosure>
      <Disclosure summary="One UTXO per block — what that means">
        A covenant pool is a single UTXO, so it can be spent once per block. That structurally removes in-block
        sandwiching and front-running. The throughput trade-off is handled by batching swaps into that one spend.
      </Disclosure>
      <Disclosure summary="How pools compose with the rest of Bellforge">
        Because a pool settles on the same covenant substrate as $BOUND transfers, an LP position is itself a
        covenant note — which means{' '}
        <Link to="/app/lend" className="text-forge-400 hover:underline">
          lending
        </Link>{' '}
        can later take it as collateral, and the minter, transfers and pools all compose on-chain rather than
        through a trusted indexer.
      </Disclosure>
    </div>
  )
}

export function Pools() {
  return (
    <>
      <PageItem>
        <PageHeader
          title="Pools"
          subtitle="Provide liquidity for any pair — quote-bound, CSFS-oracle pools that settle on the covenant substrate, with no sequencer holding your funds."
          status="rnd"
        />
      </PageItem>
      <PageItem className="space-y-6">
        <HonestBanner>
          Pools are in research. The form below is a cosmetic preview of the planned deposit flow — it moves no
          funds, and every number comes only from what you type. Quote-bound pools go live after the covenant audit.
        </HonestBanner>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <DepositPreview />
          <Guarantees />
        </div>
        <HowItWorks />
        <LivePools />
        <Rationale />
        <HonestFooter>
          Honest disclosure: pools are <span className="text-text-mid">R&amp;D, shown on regtest with zero real value</span>.
          This page describes the planned covenant design and a cosmetic deposit preview — never TVL, APR, volume or a
          live market, because none exist yet.
        </HonestFooter>
      </PageItem>
    </>
  )
}
