import { useEffect, useRef } from 'react'

/** The ONE spark system. A short-lived <canvas> that allocates an rAF ONLY while
    a burst is alive, then cancels — so many mounted instances cost zero when idle
    (unlike EmberCanvas's forever loop). Increment `fire` to trigger one burst.
    `originX/Y` are percentages (default 50). Parent must be `position: relative`. */
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hot: boolean }

export function SparkBurst({
  fire,
  count = 14,
  originX = 50,
  originY = 50,
  spread = 1,
  colorHot = true,
}: {
  fire: number
  count?: number
  originX?: number
  originY?: number
  spread?: number
  colorHot?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  useEffect(() => {
    if (fire === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    const rect = c.getBoundingClientRect()
    const W = (c.width = Math.max(1, Math.round(rect.width * DPR)))
    const H = (c.height = Math.max(1, Math.round(rect.height * DPR)))
    const ox = (originX / 100) * W
    const oy = (originY / 100) * H
    const n = Math.min(count, 18)
    const parts: P[] = Array.from({ length: n }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9
      const sp = (1.5 + Math.random() * 3.2) * spread * DPR
      return {
        x: ox,
        y: oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        max: 26 + Math.random() * 22,
        r: (0.7 + Math.random() * 1.6) * DPR,
        hot: colorHot && Math.random() < 0.6,
      }
    })
    const g = 0.12 * DPR
    const frame = () => {
      ctx.clearRect(0, 0, W, H)
      let alive = false
      for (const p of parts) {
        if (p.life >= p.max) continue
        alive = true
        p.life++
        p.vy += g
        p.vy *= 0.985
        p.x += p.vx
        p.y += p.vy
        const a = Math.max(0, 1 - p.life / p.max)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2)
        ctx.fillStyle = p.hot ? `rgba(255,210,74,${a})` : `rgba(255,76,0,${a})`
        ctx.fill()
      }
      if (alive) raf.current = requestAnimationFrame(frame)
      else ctx.clearRect(0, 0, W, H)
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf.current)
  }, [fire, count, originX, originY, spread, colorHot])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-30 h-full w-full" />
}
