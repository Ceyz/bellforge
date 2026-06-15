import type { ReactNode } from 'react'

/** The ONE R&D / empty-state forge scene. PURE CSS/SVG (no canvas, no rAF): a
    pixel cauldron with a shimmering molten pool (shared url(#molten-fill)), iron
    rim + legs + handles, a breathing under-glow, a gentle bob, rising bubbles and
    drifting embers. It is an empty-but-LIT crucible → honest by metaphor. */
export function Crucible({
  size = 140,
  copy,
  idle = true,
  className = '',
}: {
  size?: number
  copy?: ReactNode
  idle?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* breathing under/over glow */}
        <div
          aria-hidden
          className="mold-rim-pulse absolute left-1/2 rounded-full"
          style={{
            width: size * 0.66,
            height: size * 0.42,
            top: '26%',
            transform: 'translateX(-50%)',
            background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,90,0,0.45), transparent 72%)',
            filter: 'blur(7px)',
          }}
        />
        <div className={idle ? 'crucible-bob relative h-full w-full' : 'relative h-full w-full'}>
          <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="cauldron-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-ink-700)" />
                <stop offset="0.55" stopColor="var(--color-ink-850)" />
                <stop offset="1" stopColor="var(--color-ink-950)" />
              </linearGradient>
              <radialGradient id="pool-glow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--color-bell-300)" stopOpacity="0.8" />
                <stop offset="1" stopColor="var(--color-bell-300)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* legs */}
            <path d="M34 78 L29 90 L36 90 L39 80 Z" fill="var(--color-ink-900)" />
            <path d="M66 78 L71 90 L64 90 L61 80 Z" fill="var(--color-ink-900)" />

            {/* handles (side rings) */}
            <path d="M24 48 q-9 1 -9 9" fill="none" stroke="var(--color-ink-700)" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M76 48 q9 1 9 9" fill="none" stroke="var(--color-ink-700)" strokeWidth="2.4" strokeLinecap="round" />

            {/* belly */}
            <path
              d="M26 44 C17 50 15 62 23 72 C30 81 40 85 50 85 C60 85 70 81 77 72 C85 62 83 50 74 44 Z"
              fill="url(#cauldron-body)"
              stroke="var(--color-ink-600)"
              strokeWidth="1.4"
            />
            {/* left-side sheen */}
            <path d="M28 47 C22 53 21 63 26 71" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="2.2" strokeLinecap="round" />

            {/* rim band */}
            <ellipse cx="50" cy="44" rx="25" ry="6.6" fill="var(--color-ink-700)" stroke="var(--color-ink-600)" strokeWidth="1.2" />
            {/* molten pool */}
            <ellipse cx="50" cy="43.4" rx="21" ry="5.2" fill="url(#molten-fill)" className="mold-shimmer" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
            <ellipse cx="50" cy="42.6" rx="13" ry="3" fill="url(#pool-glow)" />
            {/* meniscus highlight */}
            <ellipse cx="50" cy="42.8" rx="21" ry="5.2" fill="none" stroke="var(--color-bell-300)" strokeOpacity="0.55" strokeWidth="1.1" />
          </svg>

          {/* rising bubbles + embers */}
          {idle &&
            [
              { l: 44, d: 0 },
              { l: 52, d: 0.9 },
              { l: 58, d: 1.7 },
            ].map((b, i) => (
              <span
                key={i}
                aria-hidden
                className="mold-bubble absolute rounded-full bg-bell-300"
                style={{
                  width: 4,
                  height: 4,
                  left: `${b.l}%`,
                  top: '42%',
                  animation: `mold-bubble 2.8s ease-out ${b.d}s infinite`,
                }}
              />
            ))}
        </div>
      </div>
      {copy && <div className="mt-4 text-center">{copy}</div>}
    </div>
  )
}
