import { useEffect, useRef } from 'react'

type Ember = { x: number; y: number; r: number; vy: number; vx: number; life: number; max: number; hot: boolean }

/** A cheap drifting-ember particle field on a single canvas. Capped count,
    integer-friendly, paused on tab-blur, disabled under reduced-motion. */
export function EmberCanvas({ className, count = 46 }: { className?: string; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    let W = 0
    let H = 0
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = canvas.width = Math.max(1, Math.round(r.width * DPR))
      H = canvas.height = Math.max(1, Math.round(r.height * DPR))
    }
    resize()

    const spawn = (atBottom = false): Ember => ({
      x: Math.random() * W,
      y: atBottom ? H + Math.random() * 20 * DPR : Math.random() * H,
      r: (0.6 + Math.random() * 1.7) * DPR,
      vy: (0.25 + Math.random() * 0.6) * DPR,
      vx: (Math.random() - 0.5) * 0.3 * DPR,
      life: 0,
      max: 140 + Math.random() * 180,
      hot: Math.random() < 0.32,
    })

    const parts: Ember[] = Array.from({ length: count }, () => spawn())
    let raf = 0
    let running = true

    const frame = () => {
      if (!running) return
      ctx.clearRect(0, 0, W, H)
      for (const p of parts) {
        p.x += p.vx
        p.y -= p.vy
        p.life++
        if (p.y < -10 || p.life > p.max) Object.assign(p, spawn(true))
        const a = Math.max(0, 1 - p.life / p.max) * 0.85
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.hot ? `rgba(255,178,77,${a})` : `rgba(255,76,0,${a})`
        ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    frame()

    const onVis = () => {
      running = !document.hidden
      if (running) frame()
      else cancelAnimationFrame(raf)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', resize)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', resize)
    }
  }, [count])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
