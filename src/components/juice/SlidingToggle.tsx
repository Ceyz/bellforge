import { motion } from 'motion/react'
import { SPRING_TOGGLE } from './motion'

/** The ONE sliding-indicator segmented control. The active option renders a
    motion.span with a shared `layoutId` so the indicator slides between options.
    Caller MUST pass a UNIQUE layoutId (never reuse nav-underline-*). Framer
    respects reduced-motion (snaps). */
export function SlidingToggle<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  pill = false,
  className = '',
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
  layoutId: string
  pill?: boolean
  className?: string
}) {
  return (
    <div className={`inline-flex ${pill ? 'gap-1.5' : 'rounded-btn bg-ink-900 p-1'} ${className}`}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`relative ${pill ? 'rounded-pill px-3 py-1.5 text-xs' : 'flex-1 rounded-btn px-3 py-1.5 text-sm'} font-medium capitalize transition ${
              active ? 'text-text-hi' : 'text-text-mid hover:text-text-hi'
            } ${pill && !active ? 'ring-1 ring-ink-600' : ''}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className={`absolute inset-0 -z-0 ${pill ? 'rounded-pill bg-forge-500/15 ring-1 ring-forge-500/30' : 'rounded-btn bg-ink-700'}`}
                transition={SPRING_TOGGLE}
              />
            )}
            <span className={`relative z-10 ${pill && active ? 'text-forge-300' : ''}`}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
