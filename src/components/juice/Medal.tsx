import { motion, useReducedMotion } from 'motion/react'
import { TIER, type Tier } from './tiers'

/** Pixel-art achievement medal — an octagon badge with a blocky anvil glyph
    (locked → iron padlock, desaturated). Crisp without image-rendering (vector).
    Unlocked medals glow + react to hover. */
const OCT = '9,3 15,3 21,9 21,15 15,21 9,21 3,15 3,9'

export function Medal({
  tier,
  locked = false,
  size = 40,
  label,
}: {
  tier: Tier
  locked?: boolean
  size?: number
  label: string
}) {
  const reduce = useReducedMotion()
  const t = TIER[locked ? 'iron' : tier]
  return (
    <motion.span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0"
      style={{ width: size, height: size, filter: locked ? 'none' : `drop-shadow(0 0 6px ${t.glow})` }}
      whileHover={reduce || locked ? undefined : { scale: 1.1, rotate: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 14 }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <polygon points={OCT} fill={t.face} stroke={t.rim} strokeWidth="1.4" strokeLinejoin="round" />
        <polygon points={OCT} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" transform="scale(0.82) translate(2.6 2.6)" />
        {locked ? (
          <g fill={TIER.iron.ink}>
            <rect x="8.5" y="12" width="7" height="6" rx="1" />
            <path d="M9.6 12 V10.6 a2.4 2.4 0 0 1 4.8 0 V12" fill="none" stroke={TIER.iron.ink} strokeWidth="1.2" />
          </g>
        ) : (
          <g fill={t.ink}>
            <rect x="6.5" y="10" width="11" height="2.6" rx="0.6" />
            <rect x="10" y="12.4" width="4" height="3" />
            <rect x="7.4" y="15.2" width="9.2" height="1.8" rx="0.5" />
          </g>
        )}
      </svg>
    </motion.span>
  )
}
