import { Link } from 'react-router-dom'
import { motion, useInView, useReducedMotion } from 'motion/react'
import { useRef } from 'react'
import { PageHeader } from '../components/app/PageHeader'
import { CountUp } from '../components/ui/CountUp'
import { Badge } from '../components/ui/Badge'
import { Reveal } from '../components/ui/Reveal'
import { LinkButton } from '../components/ui/Button'
import { asset, PROOF_URL } from '../config'

/* ---- Planned $BOUND facts (regtest preview — NOT minted, ZERO value) ----
   These are PLANNED genesis parameters, not market data. There is deliberately
   no price / market cap / holders / volume / chart anywhere on this page. */
const SUPPLY_CAP = 21_000_000
const MINTED = 0
const DECIMALS = 8

/** Safe percentage (guards a zero cap) — typed as plain numbers so the literal
    0 cap on regtest doesn't trip TS's never-overlap narrowing. */
const pctOf = (n: number, total: number) => (total === 0 ? 0 : (n / total) * 100)

const FACTS = [
  { k: 'Planned cap', v: '21,000,000', note: 'Fixed at genesis — never increases' },
  { k: 'Divisibility', v: '8 decimals', note: 'Splittable to 0.00000001 $BOUND' },
  { k: 'Mint model', v: 'Fair mint', note: 'No premine, no team allocation' },
  { k: 'Network', v: 'Bellscoin', note: 'Regtest today · mainnet after audit' },
]

const GUARANTEES = [
  {
    title: 'One-shot minter',
    body: 'The genesis minter is spent in the same transaction it creates supply. After genesis, no path can ever mint another $BOUND.',
  },
  {
    title: 'Conservation',
    body: 'Every transfer covenant checks inputs == outputs on-chain. The amount is conserved across splits and merges — no inflation is representable.',
  },
  {
    title: 'Owner-auth',
    body: 'A note only moves when the holder’s key signs (BIP-342). The covenant rejects spends that are not owner-authorized.',
  },
  {
    title: 'Verifiable by anyone',
    body: 'The rules live in tapscript on Bellscoin. Anyone can replay the lineage from genesis on a block explorer — no trusted indexer required.',
  },
]

export function Token() {
  return (
    <>
      <PageHeader
        title="$BOUND"
        subtitle="The first OP_CAT token on Bellscoin — divisible, covenant-secured, fixed at genesis."
        status="live-regtest"
      />

      <div className="space-y-6">
        <Hero />

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <SupplySection />
          <DistributionSection />
        </div>

        <GuaranteesSection />

        <HonestFooter />
      </div>
    </>
  )
}

/* ----------------------------- Hero ----------------------------- */

function Hero() {
  const reduce = useReducedMotion()
  return (
    <div className="relative overflow-hidden rounded-card border border-ink-600 bg-ink-800/60">
      {/* ambient ember glow — purely decorative, cheap, motion-gated */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-forge-500/20 blur-3xl"
      />
      <div className="relative grid items-center gap-6 p-7 sm:grid-cols-[auto_1fr] sm:p-9">
        <motion.img
          src={asset('icons/bound-ingot.png')}
          alt="$BOUND ingot"
          width={112}
          height={112}
          className="pixelated h-24 w-24 drop-shadow-[0_0_28px_rgba(255,76,0,0.4)] sm:h-28 sm:w-28"
          initial={reduce ? false : { opacity: 0, scale: 0.9, y: 8 }}
          animate={reduce ? {} : { opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <div>
          <Badge className="border-forge-500/30 bg-forge-500/10 text-forge-300">
            FIRST OP_CAT TOKEN
          </Badge>
          <h2 className="font-display mt-3 text-3xl leading-tight text-text-hi sm:text-4xl">
            Forged on Bellscoin, secured by its own covenant.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-mid">
            $BOUND is the genesis of the OP_CAT token standard — the reference
            implementation every later token follows. It is not minted yet:
            this is an honest preview of its planned, fixed-at-genesis economics.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <LinkButton href={PROOF_URL} variant="secondary" className="text-xs">
              View the covenant proof →
            </LinkButton>
            <Link
              to="/app/mint"
              className="text-xs font-medium text-forge-400 transition hover:underline"
            >
              How minting works
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------- Supply ---------------------------- */

function SupplySection() {
  const pctMinted = pctOf(MINTED, SUPPLY_CAP)
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Supply</SectionLabel>

      <div className="mt-4 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <SupplyGauge minted={MINTED} cap={SUPPLY_CAP} />
        <div className="space-y-3">
          <div>
            <p className="text-xs text-text-lo">Minted so far</p>
            <p className="font-mono text-3xl text-text-hi">
              <CountUp to={MINTED} /> <span className="text-base text-text-mid">/ {SUPPLY_CAP.toLocaleString()}</span>
            </p>
          </div>
          <p className="text-sm leading-relaxed text-text-mid">
            Zero $BOUND exist today. On regtest the supply gauge reads{' '}
            <span className="font-mono text-text-hi">0%</span> by design — nothing
            has been forged. The cap is{' '}
            <span className="text-text-hi">fixed the instant genesis fires</span> and
            can never move.
          </p>
        </div>
      </div>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        {FACTS.map((f) => (
          <div key={f.k} className="bg-ink-800 p-4">
            <dt className="text-xs text-text-lo">{f.k}</dt>
            <dd className="mt-0.5 font-mono text-lg text-text-hi">{f.v}</dd>
            <dd className="mt-0.5 text-xs text-text-mid">{f.note}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-xs leading-relaxed text-text-lo">
        Smallest unit: 1 / 10<sup>{DECIMALS}</sup> $BOUND ({pctMinted.toFixed(0)}% of cap
        minted). Figures are planned genesis parameters, not market data.
      </p>
    </Reveal>
  )
}

/** Hand-rolled SVG arc gauge — animated stroke-dashoffset, motion-gated.
    At 0% it shows a full faint track with a tiny ember tick so it reads as a
    real gauge at rest rather than an empty ring (honest, not misleading). */
function SupplyGauge({ minted, cap }: { minted: number; cap: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  const R = 52
  const C = 2 * Math.PI * R
  const frac = cap === 0 ? 0 : minted / cap
  // 270° arc (three-quarter dial). Reserve a visible minimum sliver so 0% still reads.
  const sweep = 0.75
  const filled = Math.max(frac, 0) * sweep

  return (
    <div className="relative h-40 w-40 shrink-0">
      <svg ref={ref} viewBox="0 0 140 140" className="h-40 w-40 -rotate-[225deg]">
        {/* track */}
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--color-ink-600)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${C * sweep} ${C}`}
        />
        {/* filled portion (0 on regtest) */}
        <motion.circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--color-forge-500)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${C * filled} ${C}`}
          initial={reduce ? false : { strokeDasharray: `0 ${C}` }}
          animate={inView ? { strokeDasharray: `${C * filled} ${C}` } : {}}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-text-hi">
          <CountUp to={pctOf(minted, cap)} suffix="%" />
        </span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">MINTED</span>
      </div>
    </div>
  )
}

/* ------------------------ Distribution ------------------------- */

function DistributionSection() {
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Distribution</SectionLabel>
      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <FairMintDonut />
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-text-mid">
            <span className="font-mono text-text-hi">100%</span> of supply is
            fair-mintable. There is no premine, no founder allocation, no
            treasury carve-out — the donut is a single slice on purpose.
          </p>
          <ul className="space-y-1.5 text-xs text-text-mid">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-forge-500" /> Fair mint — 100%
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-ink-600" /> Premine / team — 0%
            </li>
          </ul>
        </div>
      </div>
    </Reveal>
  )
}

/** Honest distribution: a donut that is intentionally one full ring (100%
    fair-mint). Animated draw-in, motion-gated. */
function FairMintDonut() {
  const reduce = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const R = 48
  const C = 2 * Math.PI * R
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg ref={ref} viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-ink-600)" strokeWidth="14" />
        <motion.circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--color-forge-500)"
          strokeWidth="14"
          strokeDasharray={`${C} ${C}`}
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={inView ? { strokeDashoffset: 0 } : {}}
          transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-text-hi">
          <CountUp to={100} suffix="%" />
        </span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">FAIR MINT</span>
      </div>
    </div>
  )
}

/* ------------------------ Guarantees --------------------------- */

function GuaranteesSection() {
  return (
    <Reveal className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
      <SectionLabel>Covenant guarantees</SectionLabel>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-mid">
        $BOUND’s rules are not promises in a docs page — they are enforced by the
        tapscript covenant that wraps every note. These hold as long as the
        covenant is correct, which the external audit verifies before mainnet.
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-well border border-ink-600 bg-ink-600 sm:grid-cols-2">
        {GUARANTEES.map((g) => (
          <div key={g.title} className="bg-ink-800 p-5">
            <h3 className="font-display text-sm text-text-hi">{g.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-mid">{g.body}</p>
          </div>
        ))}
      </div>
    </Reveal>
  )
}

/* -------------------------- Footer ----------------------------- */

function HonestFooter() {
  return (
    <div className="rounded-card border border-ink-600 bg-ink-900/60 p-5 text-center">
      <p className="text-xs leading-relaxed text-text-lo">
        Honest disclosure: $BOUND is a{' '}
        <span className="text-text-mid">regtest token with zero real value</span> and is
        not minted yet. This page shows planned genesis economics and on-chain
        guarantees only — never price, market cap, holders, or volume, because none
        exist. Mainnet follows the genesis freeze and an external audit.
      </p>
    </div>
  )
}

/* --------------------------- bits ------------------------------ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-micro text-xs tracking-[0.14em] text-forge-400">
      {String(children).toUpperCase()}
    </p>
  )
}
