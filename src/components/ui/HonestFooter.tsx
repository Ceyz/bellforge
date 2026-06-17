import type { ReactNode } from 'react'

/** Shared "honest disclosure" footer card (centered, muted) — single source for
    the card chrome reused on Pools / Lend / Token. Callers pass only the copy. */
export function HonestFooter({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-ink-600 bg-ink-900/60 p-5 text-center">
      <p className="text-xs leading-relaxed text-text-lo">{children}</p>
    </div>
  )
}
