import { SectionHeading } from '../ui/SectionHeading'

const QA: [string, string][] = [
  [
    'Is my money safe?',
    'There is no real money yet — Bellforge is on regtest with zero value. At mainnet, anti-inflation and ownership are enforced by the coin’s own script at consensus, plus an independent indexer as defense-in-depth.',
  ],
  [
    'Why regtest?',
    'We prove every covenant on a real node before risking value. Mainnet waits for the genesis freeze and an external audit.',
  ],
  [
    'Why $BELLS and $BOUND?',
    '$BELLS is the native coin and base pair; $BOUND is the first OP_CAT token forged here. Bellforge is DeFi for the whole OP_CAT ecosystem, not one token.',
  ],
  [
    'What is OP_CAT?',
    'A script primitive (active on Bellscoin mainnet) that lets a coin enforce rules on its own transactions — the basis of every Bellforge covenant.',
  ],
  [
    'Where’s the game?',
    'The permanent Bellbound game is inscribed on-chain and served from the Nintondo content host — open it from the Play link.',
  ],
]

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-16">
      <SectionHeading eyebrow="FAQ" title="Questions, answered plainly." />
      <div className="mt-8 space-y-3">
        {QA.map(([q, a]) => (
          <details key={q} className="rounded-card border border-ink-600 bg-ink-800/60 p-5">
            <summary className="cursor-pointer text-text-hi">{q}</summary>
            <p className="mt-3 text-sm leading-relaxed text-text-mid">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
