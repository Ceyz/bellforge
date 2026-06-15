import type { ReactNode } from 'react'

/** The ONE R&D / empty-state forge scene. PURE CSS (no canvas, no rAF): a pixel
    crucible with a shimmering molten surface (shared url(#molten-fill)), a
    breathing under-glow, a gentle bob and rising bubbles. It is an empty-but-LIT
    crucible → honest by metaphor (nothing is claimed to be full). */
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
        {/* breathing under-glow */}
        <div
          aria-hidden
          className="mold-rim-pulse absolute left-1/2 top-1/2 -translate-x-1/2 rounded-full"
          style={{
            width: size * 0.72,
            height: size * 0.5,
            transform: 'translate(-50%, -10%)',
            background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,76,0,0.35), transparent 72%)',
            filter: 'blur(6px)',
          }}
        />
        <div className={idle ? 'crucible-bob relative h-full w-full' : 'relative h-full w-full'}>
          <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
            {/* pot body */}
            <path d="M20 40 L26 80 Q28 86 34 86 L66 86 Q72 86 74 80 L80 40 Z" fill="var(--color-ink-700)" stroke="var(--color-ink-600)" strokeWidth="2" />
            <path d="M20 40 L80 40 L78 47 L22 47 Z" fill="var(--color-ink-800)" />
            {/* molten surface */}
            <ellipse cx="50" cy="40" rx="30" ry="8" fill="url(#molten-fill)" className="mold-shimmer" style={{ transformOrigin: 'center', transformBox: 'fill-box' }} />
            <ellipse cx="50" cy="40" rx="30" ry="8" fill="none" stroke="var(--color-bell-300)" strokeOpacity="0.5" strokeWidth="1.2" />
            {/* feet */}
            <rect x="30" y="86" width="6" height="6" rx="1" fill="var(--color-ink-600)" />
            <rect x="64" y="86" width="6" height="6" rx="1" fill="var(--color-ink-600)" />
          </svg>
          {/* rising bubbles */}
          {idle &&
            [0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden
                className="mold-bubble absolute rounded-full bg-bell-300"
                style={{
                  width: 4,
                  height: 4,
                  left: `${42 + i * 8}%`,
                  top: '38%',
                  animationDelay: `${i * 0.9}s`,
                  animationDuration: '2.7s',
                  animationIterationCount: 'infinite',
                  animationTimingFunction: 'ease-out',
                  animationName: 'mold-bubble',
                }}
              />
            ))}
        </div>
      </div>
      {copy && <div className="mt-4 text-center">{copy}</div>}
    </div>
  )
}
