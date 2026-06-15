import { useState } from 'react'
import type { ReactNode, MouseEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SparkBurst } from './SparkBurst'
import { SPRING_SNAP } from './motion'

/** Lightweight forge feedback for non-climax CTAs: a small center spark burst on
    click + whileTap squash. For secondary actions that deserve juice but not the
    full ForgeButton sequence. Under RM: a plain button. */
export function SparkButton({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  variant?: 'primary' | 'secondary'
  type?: 'button' | 'submit'
  className?: string
}) {
  const reduce = useReducedMotion()
  const [fire, setFire] = useState(0)
  const styles =
    variant === 'primary'
      ? 'bg-gradient-to-b from-forge-400 to-forge-600 text-ink-950 shadow-lg shadow-forge-600/25 hover:brightness-110'
      : 'border border-ink-600 bg-ink-800 text-text-hi hover:border-zinc-500 hover:bg-ink-700'
  return (
    <motion.button
      type={type}
      onClick={(e) => {
        if (!reduce) setFire((n) => n + 1)
        onClick?.(e)
      }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={SPRING_SNAP}
      className={`ember-glow-host relative inline-flex items-center justify-center overflow-hidden rounded-btn px-5 py-2.5 text-sm font-semibold transition ${styles} ${className}`}
    >
      <span className="relative z-10">{children}</span>
      <SparkBurst fire={fire} count={8} originX={50} originY={50} spread={0.8} />
    </motion.button>
  )
}
