import { SectionHeading } from '../ui/SectionHeading'

const RUNGS = [
  { label: 'Regtest preview', current: true, body: 'Covenant stack proven on a real node. This site.' },
  { label: 'Genesis freeze', current: false, body: 'Supply and rules become permanent and un-inflatable.' },
  { label: 'External audit', current: false, body: 'Independent covenant + indexer review before any value.' },
  { label: 'Mainnet', current: false, body: '$BOUND genesis + live DeFi on Bellscoin.' },
]

export function Roadmap() {
  return (
    <section id="roadmap" className="mx-auto max-w-3xl px-5 py-16">
      <SectionHeading eyebrow="Roadmap" title="From regtest to mainnet." />
      <ol className="mt-10 space-y-4">
        {RUNGS.map((r, i) => (
          <li key={r.label} className="flex gap-4">
            <span
              className={`mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-pill font-mono text-xs ${
                r.current ? 'bg-forge-500 text-ink-950' : 'bg-ink-700 text-text-mid ring-1 ring-ink-600'
              }`}
            >
              {i + 1}
            </span>
            <div className="flex-1 rounded-card border border-ink-600 bg-ink-800/60 px-5 py-4">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-text-hi">{r.label}</h3>
                {r.current && (
                  <span className="font-micro text-[10px] tracking-wide text-forge-300">YOU ARE HERE</span>
                )}
              </div>
              <p className="mt-1 text-sm text-text-mid">{r.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
