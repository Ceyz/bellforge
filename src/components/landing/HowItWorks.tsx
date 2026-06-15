import { SectionHeading } from '../ui/SectionHeading'

const STEPS = [
  { n: '01', title: 'Bring value', body: 'Start with $BELLS or any OP_CAT token on Bellscoin.' },
  {
    n: '02',
    title: 'The covenant forges it',
    body: 'Anti-inflation and ownership are enforced on-chain by the coin’s own script — the anvil, not a trusted indexer.',
  },
  {
    n: '03',
    title: 'Put it to work',
    body: 'Trade, pool and lend the result. Sound by construction, verifiable by anyone.',
  },
]

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <SectionHeading eyebrow="How it works" title="Bring value. Forge an asset. Put it to work." />
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
            <span className="font-mono text-sm text-forge-400">{s.n}</span>
            <h3 className="font-display mt-3 text-lg text-text-hi">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-mid">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
