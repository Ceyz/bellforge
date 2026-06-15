import { LinkButton } from '../ui/Button'
import { GAME_URL, DOCS_URL } from '../../config'

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="relative overflow-hidden rounded-well border border-ink-600 bg-ink-850 p-10 text-center">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(60% 90% at 50% 120%, rgba(255,76,0,0.18), transparent 70%)' }}
        />
        <div className="relative">
          <h2 className="font-display text-3xl text-text-hi sm:text-4xl">Play the permanent game</h2>
          <p className="mx-auto mt-3 max-w-md text-text-mid">
            Bellbound is inscribed on-chain and runs from the Nintondo content host — no install,
            no account.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <LinkButton href={GAME_URL} target="_blank" rel="noopener noreferrer">
              Play the game
            </LinkButton>
            <LinkButton href={DOCS_URL} variant="secondary">
              Read the docs · see the code
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  )
}
