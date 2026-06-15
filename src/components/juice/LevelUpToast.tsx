import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Medal } from './Medal'
import { SparkBurst } from './SparkBurst'
import type { Tier } from './tiers'

/** Global level-up celebration. A fixed bottom toast with a Medal + spark burst,
    auto-dismissing after ~3.2s. Names a RANK only — never a value. */
export function LevelUpToast({
  show,
  rankName,
  tier,
  onDone,
}: {
  show: boolean
  rankName: string
  tier: Tier
  onDone: () => void
}) {
  const reduce = useReducedMotion()
  const [fire, setFire] = useState(0)
  useEffect(() => {
    if (!show) return
    if (!reduce) setFire((n) => n + 1)
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [show, reduce, onDone])
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-card border border-forge-500/40 bg-ink-850/95 px-5 py-3 shadow-[0_0_40px_-10px_rgba(255,76,0,0.6)] backdrop-blur-xl"
        >
          <div className="relative">
            <Medal tier={tier} size={40} label={`${rankName} rank reached`} />
            <SparkBurst fire={fire} count={16} originX={50} originY={50} spread={1.1} />
          </div>
          <div>
            <p className="font-micro text-[10px] tracking-[0.14em] text-forge-400">RANK UP</p>
            <p className="font-display text-sm text-text-hi">You reached {rankName}</p>
            <p className="text-[11px] text-text-lo">An honest quest milestone — not a value.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
