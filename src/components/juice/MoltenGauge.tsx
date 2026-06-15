import { motion, useInView, useReducedMotion } from 'motion/react'
import { useRef } from 'react'
import { CountUp } from '../ui/CountUp'
import { forgeTemp } from './tiers'

const pctOf = (n: number, t: number) => (t === 0 ? 0 : (n / t) * 100)

/** The ONE radial molten gauge. Keeps the 0.75-sweep arc geometry but fills with
    a molten gradient (url(#molten-fill), shared <defs> in App.tsx) + a glowing
    leading-tip ember. At 0% (every token today) it shows an empty-mold "READY"
    rim pulse — honest, never a fake fill. No animated SVG filters. */
export function MoltenGauge({
  minted,
  cap,
  size = 160,
  label = 'MINTED',
}: {
  minted: number
  cap: number
  size?: number
  label?: string
}) {
  const reduce = useReducedMotion()
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const R = 52
  const C = 2 * Math.PI * R
  const SWEEP = 0.75
  const frac = cap === 0 ? 0 : Math.max(0, Math.min(1, minted / cap))
  const filled = frac * SWEEP
  const empty = frac === 0
  const temp = forgeTemp(frac)
  // base svg rotated -225°, arc sweeps 270°; tip angle in svg space:
  const a = ((-225 + (filled / SWEEP) * 270) * Math.PI) / 180
  const tx = 70 + R * Math.cos(a)
  const ty = 70 + R * Math.sin(a)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg ref={ref} viewBox="0 0 140 140" className="-rotate-[225deg]" style={{ width: size, height: size }}>
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="var(--color-ink-600)"
          strokeDasharray={`${C * SWEEP} ${C}`}
          className={empty && !reduce ? 'mold-rim-pulse' : ''}
        />
        {!empty && (
          <motion.circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="url(#molten-fill)"
            strokeDasharray={`${C * filled} ${C}`}
            initial={reduce ? false : { strokeDasharray: `0 ${C}` }}
            animate={inView ? { strokeDasharray: `${C * filled} ${C}` } : {}}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ filter: `drop-shadow(0 0 6px ${temp.glow})` }}
          />
        )}
      </svg>
      {!empty && !reduce && (
        <svg viewBox="0 0 140 140" className="pointer-events-none absolute inset-0 h-full w-full">
          <motion.circle
            r="6"
            fill="var(--color-bell-300)"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ delay: 1.0, duration: 0.3 }}
            cx={tx}
            cy={ty}
            style={{ filter: 'drop-shadow(0 0 8px rgba(255,210,74,0.9))' }}
          />
        </svg>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl text-text-hi">
          <CountUp to={pctOf(minted, cap)} suffix="%" />
        </span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">{empty ? 'READY' : label}</span>
        {empty && <span className="font-micro mt-0.5 text-[8px] tracking-wide text-forge-400/70">EMPTY MOLD</span>}
      </div>
    </div>
  )
}
