import { useState, useCallback } from 'react'
import { motion, useReducedMotion, useAnimationControls } from 'motion/react'
import { ForgeStage, type ForgePhase } from './ForgeStage'
import { SparkBurst } from './SparkBurst'
import { SPRING_SNAP, wait } from './motion'

/** The centerpiece forge sequence: idle → anticipate (wind-up + squash) → strike
    (hammer slam + hit-stop) → burst (sparks + screenshake + impact flash) →
    materialize (molten ingot scales in) → settle (cool + label flip), ~1.5s.

    Honesty: the visual is COSMETIC. Pre-mainnet no real `onForge` is passed, so
    clicking only plays the preview — nothing mints. The "preview" labeling + the
    surrounding regtest copy keep it honest. A real `onForge` (mainnet) is what
    records a receipt elsewhere. `disabled` makes it truly inert (no animation). */
export function ForgeButton({
  onForge,
  idleLabel = 'Preview the forge',
  doneLabel,
  disabled = false,
  className = '',
}: {
  onForge?: () => Promise<void> | void
  idleLabel?: string
  doneLabel?: string
  disabled?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<ForgePhase>('idle')
  const [fire, setFire] = useState(0)
  const shake = useAnimationControls()
  const busy = phase !== 'idle' && phase !== 'settle'

  const run = useCallback(async () => {
    if (disabled || busy) return
    if (reduce) {
      setPhase('settle')
      setFire((n) => n + 1)
      await onForge?.()
      setTimeout(() => setPhase('idle'), 600)
      return
    }
    setPhase('anticipate')
    await wait(260)
    setPhase('strike')
    await wait(100)
    setPhase('burst')
    setFire((n) => n + 1)
    shake.start({ x: [0, -6, 5, -3, 2, 0], y: [0, 4, -3, 2, -1, 0], transition: { duration: 0.34, ease: 'easeOut' } })
    await wait(60)
    setPhase('materialize')
    await onForge?.()
    await wait(460)
    setPhase('settle')
    await wait(620)
    setPhase('idle')
  }, [disabled, busy, reduce, onForge, shake])

  const label = busy ? 'Forging…' : phase === 'settle' && doneLabel ? doneLabel : idleLabel

  return (
    <motion.button
      type="button"
      onClick={run}
      disabled={disabled}
      animate={shake}
      whileTap={reduce || busy || disabled ? undefined : { scaleY: 0.92, scaleX: 1.03 }}
      transition={SPRING_SNAP}
      className={`ember-glow-host relative inline-flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-5 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-forge-600/25 transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:from-ink-700 disabled:to-ink-700 disabled:text-text-lo disabled:shadow-none ${className}`}
    >
      <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
        <ForgeStage phase={phase} reduce={!!reduce} />
        {/* spark burst centred on the anvil strike point — independent of button width */}
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2">
          <SparkBurst fire={fire} count={18} originX={50} originY={52} spread={1.1} colorHot />
        </span>
      </span>
      <span className="relative z-10">{label}</span>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 bg-forge-50"
        initial={{ opacity: 0 }}
        animate={phase === 'burst' ? { opacity: [0, 0.7, 0] } : { opacity: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
      />
    </motion.button>
  )
}
