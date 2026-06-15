import { LinkButton } from '../ui/Button'
import { Reveal } from '../ui/Reveal'
import { EmberCanvas } from './EmberCanvas'
import { GAME_URL, GITHUB_URL } from '../../config'

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <Reveal>
        <div className="relative overflow-hidden rounded-well border border-ink-600 bg-ink-850 p-10 text-center">
          <EmberCanvas className="pointer-events-none absolute inset-0 z-0 h-full w-full" count={28} />
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(60% 90% at 50% 120%, rgba(255,76,0,0.18), transparent 70%)' }}
          />
          <div className="relative z-10">
            <h2 className="font-display text-3xl text-text-hi sm:text-4xl">Play the permanent game</h2>
            <p className="mx-auto mt-3 max-w-md text-text-mid">
              Bellbound is inscribed on-chain and runs from the Nintondo content host — no install,
              no account.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <LinkButton
                href={GAME_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="shadow-[0_0_28px_-6px_rgba(255,76,0,0.55)]"
              >
                Play the game
              </LinkButton>
              <LinkButton href={GITHUB_URL} target="_blank" rel="noopener noreferrer" variant="secondary">
                See the code
              </LinkButton>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
