import { SectionHeading } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
import { Disclosure } from '../juice/Disclosure'

const QA: [string, string][] = [
  [
    'Is my money safe?',
    'It depends on the surface. The OP_CAT covenant stack ($BOUND, Deploy, Pools, Lend) is on regtest with zero value; at mainnet, anti-inflation and ownership are enforced by the coin’s own script at consensus, plus an independent indexer as defense-in-depth. Rune trading on Trade is live on Bellscoin mainnet and moves real value — it is non-custodial peer-to-peer atomic swaps, where your wallet only ever signs your own $BELLS funding input, never a rune UTXO.',
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
      <Reveal className="mt-8 space-y-3">
        {QA.map(([q, a]) => (
          <Disclosure key={q} summary={q}>
            {a}
          </Disclosure>
        ))}
      </Reveal>
    </section>
  )
}
