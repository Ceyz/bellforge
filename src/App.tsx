import { LinkButton } from './components/ui/Button'
import { Card } from './components/ui/Card'
import { StatusPill, type Status } from './components/ui/StatusPill'
import { Badge } from './components/ui/Badge'
import { PixelIcon } from './components/ui/PixelIcon'
import { ForgeHero } from './components/landing/ForgeHero'
import { HowItWorks } from './components/landing/HowItWorks'
import { Ecosystem } from './components/landing/Ecosystem'
import { TrustSecurity } from './components/landing/TrustSecurity'
import { Tech } from './components/landing/Tech'
import { Roadmap } from './components/landing/Roadmap'
import { Faq } from './components/landing/Faq'
import { FinalCta } from './components/landing/FinalCta'
import { GAME_URL, PROOF_URL, asset } from './config'

const NAV = ['Ecosystem', 'Security', 'Tech', 'Roadmap'] as const

type Surface = { title: string; blurb: string; backed: string; status: Status; sprite: string }

const SURFACES: Surface[] = [
  {
    title: 'Mint',
    blurb:
      'Forge a new OP_CAT token — fixed supply, on-chain mint fee, anti-inflation at consensus. $BOUND was the first.',
    backed: 'covenant minter',
    status: 'live-regtest',
    sprite: 'icons/surface-mint.png',
  },
  {
    title: 'Trade',
    blurb:
      'Swap $BELLS, $BOUND and any OP_CAT token via signed PSBT atomic orders — no custody, no AMM trust.',
    backed: 'PSBT atomic swap',
    status: 'soon',
    sprite: 'icons/surface-trade.png',
  },
  {
    title: 'Pools',
    blurb:
      'Provide liquidity for any pair — CSFS-oracle pools on the covenant substrate, quote-bound and block-aware.',
    backed: 'CSFS oracle pools',
    status: 'rnd',
    sprite: 'icons/surface-pools.png',
  },
  {
    title: 'Lend',
    blurb:
      'Borrow against $BELLS or token collateral — native covenant composition, not an indexer-trusted ledger.',
    backed: 'covenant collateral',
    status: 'rnd',
    sprite: 'icons/surface-lend.png',
  },
]

function Wordmark() {
  return (
    <span className="font-display text-lg tracking-tight text-text-hi">
      Bell<span className="text-forge-400">forge</span>
    </span>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-ink-600/70 bg-ink-900/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-2.5">
          <img
            src={asset('icons/bell-rune.png')}
            alt=""
            aria-hidden="true"
            className="pixelated h-7 w-7"
          />
          <Wordmark />
        </div>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="rounded-btn px-3.5 py-2 text-sm font-medium text-text-mid transition hover:bg-ink-700/70 hover:text-text-hi"
            >
              {item}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Badge className="hidden sm:inline-flex">REGTEST</Badge>
          <LinkButton href={GAME_URL} target="_blank" rel="noopener noreferrer" className="px-4 py-2">
            Play
          </LinkButton>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-5 pt-20 pb-12 text-center">
      <span className="font-micro inline-flex items-center gap-2 rounded-pill border border-forge-500/30 bg-forge-500/10 px-3.5 py-1.5 text-[11px] tracking-wide text-forge-300">
        <span className="h-1.5 w-1.5 rounded-full bg-forge-400" />
        REGTEST PREVIEW — NOT LIVE YET
      </span>

      <h1 className="font-display mx-auto mt-7 max-w-3xl text-5xl leading-[1.05] tracking-tight text-text-hi sm:text-6xl">
        DeFi, forged on{' '}
        <span className="bg-gradient-to-r from-forge-300 via-forge-500 to-bell-400 bg-clip-text text-transparent">
          Bellscoin
        </span>
      </h1>

      <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-text-mid">
        Mint, trade, pool and lend on Bellscoin —{' '}
        <span className="font-mono text-text-hi">$BELLS</span>,{' '}
        <span className="font-mono text-text-hi">$BOUND</span> and any OP_CAT token.
        Covenant-secured, enforced on-chain, not by us.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <LinkButton href={GAME_URL} target="_blank" rel="noopener noreferrer" className="px-6 py-3">
          Play the game
        </LinkButton>
        <LinkButton href={PROOF_URL} variant="secondary" className="px-6 py-3">
          View the on-chain proof
        </LinkButton>
      </div>

      <ForgeHero />
    </section>
  )
}

function HonestyBand() {
  return (
    <section className="mx-auto max-w-6xl px-5">
      <div className="rounded-card border border-forge-500/25 bg-forge-500/[0.06] px-5 py-4 text-center text-sm text-text-mid">
        <span className="text-text-hi">Currently: regtest.</span> Mainnet ships after the
        genesis freeze and an external audit. <span className="font-mono text-text-hi">$BOUND</span>{' '}
        has zero value today; nothing here moves real funds.
      </div>
    </section>
  )
}

function SurfaceGrid() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-14">
      <div className="grid gap-4 sm:grid-cols-2">
        {SURFACES.map((s) => (
          <Card key={s.title} id={s.title.toLowerCase()} className="group scroll-mt-20 hover:border-forge-500/40">
            <div className="flex items-start justify-between">
              <PixelIcon src={asset(s.sprite)} alt={`${s.title} icon`} native={64} />
              <StatusPill status={s.status} />
            </div>
            <h3 className="font-display mt-4 text-xl text-text-hi">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-mid">{s.blurb}</p>
            <p className="mt-3 text-xs text-text-lo">
              Backed by <span className="font-mono text-text-mid">{s.backed}</span>
            </p>
          </Card>
        ))}
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink-600/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-7 text-sm text-text-lo sm:flex-row">
        <div className="flex items-center gap-2.5">
          <img
            src={asset('brand/billy-mascot-64.png')}
            alt="Billy, the Bellforge blacksmith"
            className="pixelated h-8 w-8"
          />
          <Wordmark />
        </div>
        <nav className="flex items-center gap-5">
          <a href={GAME_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-text-hi">
            Play
          </a>
          <a href="#ecosystem" className="transition hover:text-text-hi">Ecosystem</a>
          <a href="#security" className="transition hover:text-text-hi">Security</a>
        </nav>
        <p>Built on OP_CAT · Bellscoin · regtest preview</p>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <HonestyBand />
        <HowItWorks />
        <SurfaceGrid />
        <Ecosystem />
        <TrustSecurity />
        <Tech />
        <Roadmap />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
