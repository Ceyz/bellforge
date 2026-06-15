import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SparkBurst } from './SparkBurst'
import { SPRING_POP } from './motion'

/** Heated-metal card wrapper: an ember-bloom rim (.heat-card, brightens on hover),
    an optional spring lift, and an optional hover spark burst. Under RM: static
    rim only, no lift/spark. */
export function ForgeCard({
  children,
  className = '',
  spark = false,
  lift = true,
}: {
  children: ReactNode
  className?: string
  spark?: boolean
  lift?: boolean
}) {
  const reduce = useReducedMotion()
  const [fire, setFire] = useState(0)
  return (
    <motion.div
      onHoverStart={spark && !reduce ? () => setFire((n) => n + 1) : undefined}
      whileHover={reduce || !lift ? undefined : { y: -4 }}
      transition={SPRING_POP}
      className={`heat-card relative ${className}`}
    >
      {children}
      {spark && <SparkBurst fire={fire} count={5} originX={14} originY={20} spread={0.7} />}
    </motion.div>
  )
}
