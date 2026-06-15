import { Link } from 'react-router-dom'
import { SectionHeading } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
import { PixelIcon } from '../ui/PixelIcon'
import { asset } from '../../config'

const TOKENS = [
  {
    sym: '$BELLS',
    tag: 'Native coin',
    body: 'The base asset and gas of Bellscoin — the liquidity anchor every pair trades against.',
    sprite: undefined as string | undefined,
    to: '/app/token/bells',
    cta: 'View $BELLS',
  },
  {
    sym: '$BOUND',
    tag: 'First OP_CAT token',
    body: 'The Bellbound game’s premium token and the first OP_CAT token on Bellscoin — divisible, covenant-secured. The game’s token, not ours.',
    sprite: 'icons/bound-ingot.png',
    to: '/app/token/bound',
    cta: 'View $BOUND',
  },
  {
    sym: 'OP_CAT tokens',
    tag: 'The open standard',
    body: 'Any token following the covenant standard. Mint your own, then trade, pool and lend it alongside the rest.',
    sprite: undefined,
    to: '/app/token',
    cta: 'Browse tokens',
  },
]

const CARD =
  'flex h-full flex-col rounded-card border border-ink-600 bg-ink-800/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-forge-500/40 hover:shadow-[0_0_34px_-10px_rgba(255,76,0,0.45)]'

export function Ecosystem() {
  return (
    <section id="ecosystem" className="mx-auto max-w-6xl px-5 py-16">
      <SectionHeading
        eyebrow="The ecosystem"
        title="Not one token — the whole OP_CAT economy."
        lead="Bellforge is DeFi for everything on Bellscoin, not a single coin."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {TOKENS.map((t, i) => (
          <Reveal key={t.sym} delay={i * 0.08} className="h-full">
            <Link to={t.to} className="block h-full">
              <div className={CARD}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    {t.sprite && <PixelIcon src={asset(t.sprite)} alt="" native={48} />}
                    <span className="font-mono text-base text-text-hi">{t.sym}</span>
                  </span>
                  <span className="font-micro text-[11px] tracking-wide text-bell-300">{t.tag.toUpperCase()}</span>
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-text-mid">{t.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-forge-400">
                  {t.cta} →
                </span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
