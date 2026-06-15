import { useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/** Animated expander — replaces native <details>. AnimatePresence height/opacity
    expand + a rotating ember chevron. Under RM the height jump is instant
    (transition durations clamped globally; we also skip the spring). */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`rounded-card border bg-ink-800/60 p-5 transition ${open ? 'border-forge-500/30' : 'border-ink-600 hover:border-forge-500/30'}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="font-display text-text-hi">{summary}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
          className="shrink-0 text-forge-400"
        >
          ▸
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-3 text-sm leading-relaxed text-text-mid">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
