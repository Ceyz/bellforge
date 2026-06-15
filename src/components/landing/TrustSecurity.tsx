import { LinkButton } from '../ui/Button'
import { SectionHeading } from '../ui/SectionHeading'
import { PROOF_URL } from '../../config'

const POINTS = [
  {
    title: 'Verifiable on-chain proof',
    body: 'Check the anti-inflation covenant on the regtest explorer yourself — behaviour beats a badge.',
  },
  {
    title: 'Open source',
    body: 'The covenant, the indexer and this site are public. Read the code, run the second validator.',
  },
  {
    title: 'Audit, honestly',
    body: 'An external audit is scheduled before mainnet. No fake badge — we link the report when it exists.',
  },
  {
    title: 'Sound by construction',
    body: 'Supply can’t be inflated and tokens can’t be stolen — the coin’s own script enforces it at consensus.',
  },
]

export function TrustSecurity() {
  return (
    <section id="security" className="mx-auto max-w-6xl px-5 py-16">
      <SectionHeading eyebrow="Trust & security" title="Verifiable, not promised." />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="rounded-card border border-ink-600 bg-ink-800/60 p-6">
            <h3 className="font-display text-lg text-text-hi">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-mid">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 text-center">
        <LinkButton href={PROOF_URL} variant="secondary">
          View the on-chain proof
        </LinkButton>
      </div>
    </section>
  )
}
