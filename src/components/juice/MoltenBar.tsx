import { motion, useReducedMotion } from 'motion/react'

/** The ONE linear molten bar. GPU scaleX from transform-origin:left (not width),
    grows once in view, glowing leading edge. At pct<=0 → empty lit channel +
    mold-rim-pulse (honest). `forge` tone = live ember signal; `ask`/`bid` =
    muted red/green (illustrative — visually distinct from a live tick). */
const TONE = {
  forge: { grad: 'linear-gradient(90deg,var(--color-forge-600),var(--color-forge-400),var(--color-bell-300))', glow: 'rgba(255,76,0,0.5)' },
  ask: { grad: 'linear-gradient(90deg,rgba(239,68,68,0.25),rgba(239,68,68,0.5))', glow: 'rgba(239,68,68,0.5)' },
  bid: { grad: 'linear-gradient(90deg,rgba(16,185,129,0.25),rgba(16,185,129,0.5))', glow: 'rgba(16,185,129,0.5)' },
} as const

export function MoltenBar({
  pct,
  tone = 'forge',
  height = 6,
  delay = 0,
  label,
  caption,
  className = '',
}: {
  pct: number
  tone?: keyof typeof TONE
  height?: number
  delay?: number
  label?: string
  caption?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const t = TONE[tone]
  const f = Math.max(0, Math.min(100, pct)) / 100
  const empty = f <= 0
  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      {label && <span className="font-mono text-text-hi">{label}</span>}
      <span className="relative block w-full overflow-hidden rounded-pill bg-ink-700" style={{ height }}>
        {empty && !reduce && (
          <span className="mold-rim-pulse absolute inset-0 rounded-pill" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,76,0,0.22)' }} />
        )}
        {!empty && (
          <motion.span
            className="absolute inset-y-0 left-0 origin-left rounded-pill"
            style={{ width: '100%', transformOrigin: 'left', background: t.grad, boxShadow: `0 0 8px ${t.glow}` }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: f }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay }}
          />
        )}
      </span>
      {caption && <span className="text-[10px] text-text-lo">{caption}</span>}
    </span>
  )
}
