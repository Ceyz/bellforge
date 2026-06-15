export type Status = 'live-regtest' | 'soon' | 'rnd'

const META: Record<Status, { label: string; cls: string }> = {
  'live-regtest': {
    label: 'Live · regtest',
    cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  },
  soon: { label: 'Soon', cls: 'bg-forge-500/15 text-forge-300 ring-forge-500/30' },
  rnd: { label: 'R&D', cls: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30' },
}

export function StatusPill({ status }: { status: Status }) {
  const m = META[status]
  return (
    <span className={`rounded-pill px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      {m.label}
    </span>
  )
}
