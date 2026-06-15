import { useEffect, useRef } from 'react'
import { animate, useInView, useMotionValue, useReducedMotion } from 'motion/react'

/** Animated count-up for figures. Fires once when scrolled into view; respects
    prefers-reduced-motion (snaps straight to the final value). No extra deps —
    drives a MotionValue and writes the formatted number straight to the DOM
    node, so there is no per-frame React re-render. Render amounts in font-mono. */
export function CountUp({
  to,
  duration = 1.4,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: {
  to: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)

  const format = (v: number) =>
    `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`

  // Render the start/end value without waiting for the animation frame.
  const initial = format(reduce ? to : 0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const write = () => {
      node.textContent = format(mv.get())
    }
    const unsub = mv.on('change', write)
    if (!inView || reduce) {
      mv.set(to)
      write()
      return unsub
    }
    const controls = animate(mv, to, { duration, ease: [0.22, 1, 0.36, 1] })
    return () => {
      controls.stop()
      unsub()
    }
    // format is derived from stable props; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduce, to, duration])

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  )
}
