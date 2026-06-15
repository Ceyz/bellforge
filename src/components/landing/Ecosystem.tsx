import { SectionHeading } from '../ui/SectionHeading'

const TOKENS = [
  {
    sym: '$BELLS',
    tag: 'Native coin',
    body: 'The base asset and gas of Bellscoin — the liquidity anchor every pair trades against.',
  },
  {
    sym: '$BOUND',
    tag: 'First OP_CAT token',
    body: 'The flagship token forged on Bellforge (the game’s premium token). Divisible, covenant-secured, the genesis of the standard.',
  },
  {
    sym: 'OP_CAT tokens',
    tag: 'The open standard',
    body: 'Any token following the covenant standard. Mint your own, then trade, pool and lend it alongside the rest.',
  },
]

export function Ecosystem() {
  return (
    <section id="ecosystem" className="mx-auto max-w-6xl px-5 py-16">
      <SectionHeading
        eyebrow="The ecosystem"
        title="Not one token — the whole OP_CAT economy."
        lead="Bellforge is DeFi for everything on Bellscoin, not a single coin."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {TOKENS.map((t) => (
          <div key={t.sym} className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-base text-text-hi">{t.sym}</span>
              <span className="font-micro text-[10px] tracking-wide text-bell-300">
                {t.tag.toUpperCase()}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-text-mid">{t.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
