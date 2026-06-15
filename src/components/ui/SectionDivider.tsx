import { motion, useReducedMotion, useInView } from 'motion/react'
import { useRef } from 'react'

/** Animated ember divider: two hairlines draw in on scroll with a spark at
    center. useInView(once); no-op under reduced motion. Use sparingly. */
export function SectionDivider({ className = '' }: { className?: string }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-20%' })
  return (
    <div ref={ref} className={`mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 ${className}`} aria-hidden>
      <motion.span
        className="h-px flex-1 origin-right bg-gradient-to-l from-forge-500/50 to-transparent"
        initial={reduce ? false : { scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.span
        className="h-1.5 w-1.5 rotate-45 bg-forge-400 shadow-[0_0_10px_2px_rgba(255,76,0,0.45)]"
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        animate={inView ? { scale: 1, opacity: 1 } : {}}
        transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 18 }}
      />
      <motion.span
        className="h-px flex-1 origin-left bg-gradient-to-r from-forge-500/50 to-transparent"
        initial={reduce ? false : { scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}
