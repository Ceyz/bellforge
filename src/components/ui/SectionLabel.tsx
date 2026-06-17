import type { ReactNode } from 'react'

/** The canonical in-page micro section label (forge eyebrow). Single source for
    the `font-micro text-xs tracking-[0.14em] text-forge-400` pattern reused on
    Pools / Lend / Token. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="font-micro text-xs tracking-[0.14em] text-forge-400">{String(children).toUpperCase()}</p>
}
