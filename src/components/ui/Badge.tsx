import type { HTMLAttributes } from 'react'

/** Tiny Silkscreen micro-label (status chip, eyebrow). Native pixel face — keep it small. */
export function Badge({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`font-micro inline-flex items-center gap-1.5 rounded-pill border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] tracking-wide text-text-mid ${className}`}
      {...props}
    />
  )
}
