type Props = {
  /** Sprite path (under /icons). When absent, renders a framed placeholder. */
  src?: string
  alt: string
  /** Native sprite grid in px (authored size). */
  native?: number
  /** Integer upscale factor only (avoids the DPR blur trap). */
  scale?: number
  className?: string
}

/** Renders a pixel-art sprite crisply (integer-scaled, nearest-neighbor).
    Until the real sprites land, `src`-less usage shows a forge-framed placeholder. */
export function PixelIcon({ src, alt, native = 64, scale = 1, className = '' }: Props) {
  const size = native * scale
  if (!src) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={`flex items-center justify-center rounded-md bg-ink-700 ring-1 ring-ink-600 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <img src={src} alt={alt} width={size} height={size} className={`pixelated ${className}`} />
  )
}
