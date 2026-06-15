import type { ReactNode } from 'react'

/** Shared "no fake numbers" callout. Static (no motion). */
export function HonestBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      className="rounded-card border border-dashed border-forge-500/30 bg-forge-500/[0.06] px-5 py-4 text-sm leading-relaxed text-text-mid"
    >
      <span aria-hidden className="mr-2 text-text-lo">
        ⓘ
      </span>
      {children}
    </div>
  )
}
