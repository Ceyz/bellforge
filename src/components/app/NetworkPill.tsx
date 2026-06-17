import { EmberDot } from '../ui/EmberDot'

/** Honest dual-network indicator, shared by the app shell and the landing header.
    The OP_CAT/$BOUND covenant stack is regtest (R&D, zero value); runes + $BELLS
    reads are live on Bellscoin mainnet. A single blanket "regtest" pill would
    mislabel the real-value rune surface. */
export function NetworkPill() {
  return (
    <span
      className="hidden items-center gap-2 rounded-full bg-ink-700 px-2.5 py-1 text-[11px] font-medium ring-1 ring-ink-600 sm:inline-flex"
      title="OP_CAT / $BOUND are on regtest (zero value). Runes and $BELLS balances are live on Bellscoin mainnet."
    >
      <span className="inline-flex items-center gap-1 text-forge-300">
        <EmberDot /> OP_CAT regtest
      </span>
      <span className="text-ink-600">·</span>
      <span className="inline-flex items-center gap-1 text-live-300">
        <span className="h-1.5 w-1.5 rounded-full bg-live-500" /> runes mainnet
      </span>
    </span>
  )
}
