import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

/* Bellforge route-transition primitives.
   Snappy, eased, reduced-motion-safe. Easing matches Reveal: [0.22, 1, 0.36, 1]. */

const EASE = [0.22, 1, 0.36, 1] as const

/** Enter/exit variants for a routed page. Subtle fade + small y + micro-scale. */
const pageVariants = {
  initial: { opacity: 0, y: 12, scale: 0.992 },
  enter: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.996 },
}

/**
 * Wraps a single route element so it animates in on mount and out on unmount.
 * Must live INSIDE an <AnimatePresence> whose child is keyed by the pathname
 * (see App.tsx), otherwise exit animations never fire.
 *
 * `stagger` (default true) turns this into a stagger container: direct children
 * tagged with <PageItem> (or any motion child reading `pageItem`) lift in in
 * sequence. Pass stagger={false} for pages that manage their own internal motion.
 *
 * Under prefers-reduced-motion this collapses to a plain <div> — no transform,
 * no opacity churn — so the page just appears.
 */
export function PageTransition({
  children,
  stagger = true,
  className,
}: {
  children: ReactNode
  stagger?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
      transition={{
        duration: 0.34,
        ease: EASE,
        // Stagger only the enter; children inherit `enter` from this container.
        ...(stagger ? { when: 'beforeChildren', staggerChildren: 0.05, delayChildren: 0.04 } : {}),
      }}
    >
      {children}
    </motion.div>
  )
}

/** Per-block stagger variants for in-page content. */
const itemVariants = {
  initial: { opacity: 0, y: 14 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  // No exit transition on items — the parent's fade-out covers the whole page.
  exit: { opacity: 0 },
}

/**
 * A single staggered block inside a <PageTransition stagger>. Drop it around
 * the header, each card row, etc. Reduced-motion-safe (renders a plain div).
 */
export function PageItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}
