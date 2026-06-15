import { useEffect, useRef } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'

/** The ONE number animator for CHANGING values (CountUp stays for first-in-view
    ramps). Drives a MotionValue, writes textContent directly (no re-render),
    re-ramps on every `value` change, and pulses .odometer-glow when the value
    actually changes. Under RM: snaps, no glow. Used for the live electrs balance. */
export function OdometerNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  glowOnChange = true,
  className = '',
}: {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  glowOnChange?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const mv = useMotionValue(value)
  const prev = useRef(value)
  const fmt = (v: number) =>
    `${prefix}${v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const write = () => {
      node.textContent = fmt(mv.get())
    }
    const unsub = mv.on('change', write)
    if (reduce) {
      mv.set(value)
      write()
      prev.current = value
      return unsub
    }
    const c = animate(mv, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] })
    if (glowOnChange && prev.current !== value) {
      node.classList.remove('odometer-glow')
      void node.offsetWidth
      node.classList.add('odometer-glow')
    }
    prev.current = value
    return () => {
      c.stop()
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce])
  return (
    <span ref={ref} className={className}>
      {fmt(value)}
    </span>
  )
}
