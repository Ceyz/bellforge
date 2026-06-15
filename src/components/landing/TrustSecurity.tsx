import { LinkButton } from '../ui/Button'
import { SectionHeading } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
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
        {POINTS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.07} className="h-full">
            <div className="h-full rounded-card border border-ink-600 bg-ink-800/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-forge-500/40 hover:shadow-[0_0_34px_-10px_rgba(255,76,0,0.45)]">
              <h3 className="font-display text-lg text-text-hi">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-mid">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-8 text-center">
        <LinkButton href={PROOF_URL} variant="secondary">
          View the on-chain proof
        </LinkButton>
      </Reveal>
    </section>
  )
}
