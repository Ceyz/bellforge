import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

/** Scroll-reveal wrapper: fades + lifts (and optionally drifts/blurs) content in
    once it enters the viewport. Backward-compatible defaults = the original
    fade+lift. No-ops under prefers-reduced-motion. */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  x = 0,
  blur = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  x?: number
  blur?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, x, filter: blur ? `blur(${blur}px)` : 'blur(0px)' }}
      whileInView={{ opacity: 1, y: 0, x: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{
        type: 'spring',
        stiffness: 120,
        damping: 20,
        mass: 0.6,
        delay,
        opacity: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
      }}
    >
      {children}
    </motion.div>
  )
}
