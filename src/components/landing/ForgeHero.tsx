import { useEffect, useRef } from 'react'
import { asset } from '../../config'

const p = (name: string) => asset(`forge/${name}`)

/** The forge hero: a responsive poster (LCP element) behind a looping, muted,
    silent forge video. The video is only played when motion + bandwidth allow —
    otherwise the poster (Billy at the anvil) stays. DESIGN_PLAN §6. */
export function ForgeHero() {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    const cheap = conn?.saveData === true || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g'
    if (reduce || cheap) return // poster only

    v.play().catch(() => {}) // Low Power Mode / autoplay refusal → keep poster
    const onVis = () => {
      if (document.hidden) v.pause()
      else v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return (
    <div
      className="relative mx-auto mt-14 max-w-5xl overflow-hidden rounded-well border border-ink-600 bg-ink-950"
      style={{ aspectRatio: '16 / 9' }}
    >
      <picture>
        <source
          type="image/webp"
          srcSet={`${p('forge-poster-832.webp')} 832w, ${p('forge-poster-1280.webp')} 1280w, ${p('forge-poster-1920.webp')} 1920w`}
          sizes="(max-width: 1024px) 100vw, 1024px"
        />
        <img
          src={p('forge-poster-1280.jpg')}
          alt="Billy the blacksmith at the forge"
          className="absolute inset-0 h-full w-full object-cover"
          fetchPriority="high"
          decoding="async"
        />
      </picture>
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src={p('forge.av1.mp4')} type='video/mp4; codecs="av01.0.05M.08"' />
        <source src={p('forge.h264.mp4')} type='video/mp4; codecs="avc1.4D401E"' />
      </video>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink-950/55 to-transparent" />
    </div>
  )
}
