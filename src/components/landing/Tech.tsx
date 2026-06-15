import { LinkButton } from '../ui/Button'
import { SectionHeading } from '../ui/SectionHeading'
import { DOCS_URL } from '../../config'

const ITEMS = [
  {
    q: 'What is OP_CAT, and why does it matter?',
    a: 'OP_CAT (active on Bellscoin mainnet) lets a coin’s script introspect its own transaction. Bellforge uses it to build covenants — rules the coin enforces on itself: a token can’t mint past its fixed supply, and only its owner can move it. No bridge, no custodian, no trusted indexer.',
  },
  {
    q: 'How is anti-inflation enforced?',
    a: 'Every transfer reconstructs and binds its own outputs: what leaves equals what was proven to enter (conservation by construction). An inflated output simply fails to validate at consensus. An independent indexer re-checks the same rule as defense-in-depth.',
  },
]

export function Tech() {
  return (
    <section id="tech" className="mx-auto max-w-3xl px-5 py-16">
      <SectionHeading
        eyebrow="The tech"
        title="Soundness, enforced by the coin’s own script."
        lead="The supply can’t be inflated — it’s enforced on-chain, not by us."
      />
      <div className="mt-8 space-y-3">
        {ITEMS.map((it) => (
          <details key={it.q} className="rounded-card border border-ink-600 bg-ink-800/60 p-5">
            <summary className="cursor-pointer font-display text-text-hi">{it.q}</summary>
            <p className="mt-3 text-sm leading-relaxed text-text-mid">{it.a}</p>
          </details>
        ))}
      </div>
      <div className="mt-6 text-center">
        <LinkButton href={DOCS_URL} variant="secondary">
          Read the docs
        </LinkButton>
      </div>
    </section>
  )
}
