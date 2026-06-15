import { Link, useParams } from 'react-router-dom'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/app/PageHeader'
import { CountUp } from '../components/ui/CountUp'
import { Badge } from '../components/ui/Badge'
import { Reveal } from '../components/ui/Reveal'
import { LinkButton } from '../components/ui/Button'
import { EmberDot } from '../components/ui/EmberDot'
import { MoltenGauge } from '../components/juice/MoltenGauge'
import { ForgeButton } from '../components/juice/ForgeButton'
import { fetchChainTip, type ChainTip } from '../lib/chain'
import { asset, EXPLORER, PROOF_URL } from '../config'
import { getToken, type TokenInfo } from '../lib/tokens'

export function Token() {
  const { sym } = useParams<{ sym: string }>()
  const token = getToken(sym)

  if (!token) {
    return (
      <div className="rounded-card border border-ink-600 bg-ink-800/60 p-10 text-center">
        <p className="text-text-mid">Unknown token.</p>
        <Link to="/app/token" className="mt-4 inline-block text-sm text-forge-400 hover:underline">
          ← All tokens
        </Link>
      </div>
    )
  }

  const isOpcat = token.type === 'opcat' && token.cap != null

  return (
    <>
      <PageHeader title={token.sym} subtitle={token.blurb} status={token.status} />
      <div className="mb-6">
        <Link to="/app/token" className="text-xs text-text-lo transition hover:text-text-hi">
          ← All tokens
        </Link>
      </div>

      <div className="space-y-6">
        <Hero token={token} />

        {isOpcat ? (
          <>
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <SupplySection token={token} />
              <DistributionSection token={token} />
            </div>
            <GuaranteesSection token={token} />
          </>
        ) : (
          <>
            <NativeLive />
            <AboutSection token={token} />
          </>
        )}

        <HonestFooter token={token} />
      </div>
    </>
  )
}

function Hero({ token }: { token: TokenInfo }) {
  const reduce = useReducedMotion()
  return (
    <div className="relative overflow-hidden rounded-card border border-ink-600 bg-ink-800/60">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-forge-500/20 blur-3xl" />
      <div className="relative grid items-center gap-6 p-7 sm:grid-cols-[auto_1fr] sm:p-9">
        {token.sprite ? (
          <motion.img
            src={asset(token.sprite)}
            alt={`${token.sym} mark`}
            width={112}
            height={112}
            className="pixelated heat-breathe h-24 w-24 sm:h-28 sm:w-28"
            initial={reduce ? false : { opacity: 0, scale: 0.9, y: 8 }}
            animate={reduce ? {} : { opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-well bg-ink-700 font-mono text-lg text-bell-300 ring-1 ring-ink-600 sm:h-28 sm:w-28">
            {token.sym}
          </div>
        )}
        <div>
          <Badge className="border-forge-500/30 bg-forge-500/10 text-forge-300">{token.tag.toUpperCase()}</Badge>
          <h2 className="font-display mt-3 text-3xl leading-tight text-text-hi sm:text-4xl">{token.name}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-mid">{token.origin}</p>
          {token.type === 'opcat' && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <LinkButton href={PROOF_URL} variant="secondary" className="text-xs">
                View the covenant proof →
              </LinkButton>
              <Link to="/app/deploy" className="text-xs font-medium text-forge-400 transition hover:underline">
                How deploying works
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SupplySection({ token }: { token: TokenInfo }) {
  const cap = token.cap ?? 0
  const minted = token.minted ?? 0
  const mintable = minted < cap
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Supply</SectionLabel>
      <div className="mt-4 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <MoltenGauge minted={minted} cap={cap} />
        <div className="space-y-3">
          <div>
            <p className="text-xs text-text-lo">Minted so far</p>
            <p className="font-mono text-3xl text-text-hi">
              <CountUp to={minted} /> <span className="text-base text-text-mid">/ {cap.toLocaleString()}</span>
            </p>
          </div>
          <p className="text-sm leading-relaxed text-text-mid">
            Zero {token.sym} exist today. The mold is lit and empty — the gauge reads{' '}
            <span className="font-mono text-text-hi">0%</span> by design. The cap is{' '}
            <span className="text-text-hi">fixed the instant genesis fires</span> and can never move.
          </p>
          {mintable && (
            <div className="pt-1">
              <ForgeButton idleLabel={`Forge ${token.sym} — preview`} doneLabel={`${token.sym} struck (preview)`} />
              <p className="mt-2 text-xs text-text-lo">
                Cosmetic preview of the fair mint. Real minting opens at mainnet, after the genesis freeze + audit.
              </p>
            </div>
          )}
        </div>
      </div>
      <dl className="mt-6 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        {token.facts.map((f) => (
          <div key={f.k} className="heat-card bg-ink-800 p-4">
            <dt className="text-xs text-text-lo">{f.k}</dt>
            <dd className="mt-0.5 font-mono text-lg text-text-hi">{f.v}</dd>
            <dd className="mt-0.5 text-xs text-text-mid">{f.note}</dd>
          </div>
        ))}
      </dl>
    </Reveal>
  )
}

function DistributionSection({ token }: { token: TokenInfo }) {
  const dist = token.distribution ?? [{ label: 'Fair mint', pct: 100 }]
  const fairPct = dist[0]?.pct ?? 100
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Distribution</SectionLabel>
      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <Donut pct={fairPct} />
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-text-mid">
            <span className="font-mono text-text-hi">{fairPct}%</span> of supply is fair-mintable.
            No premine, no founder allocation, no treasury carve-out.
          </p>
          <ul className="space-y-1.5 text-xs text-text-mid">
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-forge-500" /> {dist[0]?.label ?? 'Fair mint'} — {fairPct}%</li>
            <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-ink-600" /> Premine / team — {100 - fairPct}%</li>
          </ul>
        </div>
      </div>
    </Reveal>
  )
}

function Donut({ pct }: { pct: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const R = 48
  const C = 2 * Math.PI * R
  const frac = Math.max(0, Math.min(1, pct / 100))
  const offset = C * (1 - frac)
  const a = frac * 2 * Math.PI
  const tx = 70 + R * Math.cos(a)
  const ty = 70 + R * Math.sin(a)
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg ref={ref} viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-ink-600)" strokeWidth="14" />
        <motion.circle
          cx="70" cy="70" r={R} fill="none" stroke="url(#molten-fill)" strokeWidth="14"
          strokeDasharray={`${C} ${C}`}
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={inView ? { strokeDashoffset: offset } : {}}
          transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
        />
        {!reduce && frac > 0 && (
          <motion.circle
            r="5.5" fill="var(--color-bell-300)" cx={tx} cy={ty}
            initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 1.1, duration: 0.3 }}
            style={{ filter: 'drop-shadow(0 0 7px rgba(255,210,74,0.9))' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-text-hi"><CountUp to={pct} suffix="%" /></span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">FAIR MINT</span>
      </div>
    </div>
  )
}

function GuaranteesSection({ token }: { token: TokenInfo }) {
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Covenant guarantees</SectionLabel>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-mid">
        {token.sym}’s rules are enforced by the tapscript covenant that wraps every note — not promises in a
        docs page. They hold as long as the covenant is correct, which the external audit verifies before mainnet.
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        {token.guarantees.map((g) => (
          <div key={g.title} className="heat-card bg-ink-800 p-5">
            <h3 className="font-display text-sm text-text-hi">{g.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-mid">{g.body}</p>
          </div>
        ))}
      </div>
    </Reveal>
  )
}

function AboutSection({ token }: { token: TokenInfo }) {
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>About</SectionLabel>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        {token.facts.map((f) => (
          <div key={f.k} className="heat-card bg-ink-800 p-4">
            <dt className="text-xs text-text-lo">{f.k}</dt>
            <dd className="mt-0.5 font-mono text-lg text-text-hi">{f.v}</dd>
            <dd className="mt-0.5 text-xs text-text-mid">{f.note}</dd>
          </div>
        ))}
      </dl>
    </Reveal>
  )
}

function ago(sec: number) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

/** Real, live Bellscoin network stats from electrs — shown on the native $BELLS
    page while OP_CAT token indexing is still being built. Honest: only data the
    chain actually returns; nothing fabricated. */
function NativeLive() {
  const [tip, setTip] = useState<ChainTip | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  useEffect(() => {
    let alive = true
    fetchChainTip('mainnet').then((r) => {
      if (!alive) return
      if ('error' in r) setState('error')
      else {
        setTip(r)
        setState('ok')
      }
    })
    return () => {
      alive = false
    }
  }, [])
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <div className="flex items-center justify-between">
        <SectionLabel>Live on Bellscoin</SectionLabel>
        <span className="flex items-center gap-1.5 font-micro text-[10px] uppercase tracking-wide text-text-lo">
          <EmberDot /> mainnet
        </span>
      </div>
      {state === 'error' ? (
        <p className="mt-4 text-sm text-text-mid">Network stats are unavailable right now.</p>
      ) : (
        <dl className="mt-4 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-3">
          <Stat k="Block height" v={tip ? tip.height.toLocaleString() : '…'} note="Current chain tip" />
          <Stat k="Last block" v={tip ? ago(tip.time) : '…'} note="Time since the tip" />
          <Stat k="Txs in tip" v={tip ? tip.txCount.toLocaleString() : '…'} note="Transactions in the latest block" />
        </dl>
      )}
      <div className="mt-5">
        <LinkButton href={`${EXPLORER}/blocks`} target="_blank" rel="noopener noreferrer" variant="secondary" className="text-xs">
          Open the block explorer →
        </LinkButton>
      </div>
    </Reveal>
  )
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="heat-card bg-ink-800 p-4">
      <dt className="text-xs text-text-lo">{k}</dt>
      <dd className="mt-0.5 font-mono text-lg text-text-hi">{v}</dd>
      <dd className="mt-0.5 text-xs text-text-mid">{note}</dd>
    </div>
  )
}

function HonestFooter({ token }: { token: TokenInfo }) {
  return (
    <div className="rounded-card border border-ink-600 bg-ink-900/60 p-5 text-center">
      <p className="text-xs leading-relaxed text-text-lo">
        Honest disclosure: {token.sym} is shown on{' '}
        <span className="text-text-mid">regtest with zero real value</span>
        {token.type === 'opcat' ? ' and is not minted yet' : ''}. This page shows planned/on-chain facts only —
        never price, market cap, holders, or volume, because none exist.
      </p>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-micro text-xs tracking-[0.14em] text-forge-400">{String(children).toUpperCase()}</p>
}
