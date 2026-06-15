import { LinkButton } from '../ui/Button'
import { SectionHeading } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
import { DOCS_URL } from '../../config'

const ITEMS = [
  {
    q: 'What is OP_CAT, and why does it matter?',
    a: 'OP_CAT (active on Bellscoin mainnet) lets a coin’s script introspect its own transaction. Bellforge uses it to build covenants — rules the coin enforces on itself: a token can’t mint past its fixed supply, and only its owner can move it. No bridge, no custodian, no trusted indexer.',
  },
  {
    q: 'How is anti-inflation enforced?',
    a: 'A token’s supply is fixed at genesis (the minter is one-shot, then spent). Every later transfer reconstructs and binds its own outputs so what leaves equals what was proven to enter — an inflated output fails to validate at consensus. This holds as long as the covenant is correct, which is exactly what the audit checks; an independent indexer re-verifies the same rule as defense-in-depth.',
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
      <Reveal className="mt-8 space-y-3">
        {ITEMS.map((it) => (
          <details key={it.q} className="rounded-card border border-ink-600 bg-ink-800/60 p-5 transition hover:border-forge-500/30">
            <summary className="cursor-pointer font-display text-text-hi">{it.q}</summary>
            <p className="mt-3 text-sm leading-relaxed text-text-mid">{it.a}</p>
          </details>
        ))}
        <div className="pt-2 text-center">
          <LinkButton href={DOCS_URL} variant="secondary">
            Read the docs
          </LinkButton>
        </div>
      </Reveal>
    </section>
  )
}
