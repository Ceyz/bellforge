export type Status = 'live-regtest' | 'live-mainnet' | 'soon' | 'rnd'

const META: Record<Status, { label: string; cls: string }> = {
  'live-regtest': {
    label: 'Live · regtest',
    cls: 'bg-live-500/15 text-live-300 ring-live-500/30',
  },
  'live-mainnet': {
    label: 'Live · mainnet',
    cls: 'bg-live-500/15 text-live-300 ring-live-500/30',
  },
  soon: { label: 'Soon', cls: 'bg-forge-500/15 text-forge-300 ring-forge-500/30' },
  rnd: { label: 'R&D', cls: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30' },
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const m = META[status]
  return (
    <span className={`rounded-pill px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${m.cls}`}>
      {label ?? m.label}
    </span>
  )
}
