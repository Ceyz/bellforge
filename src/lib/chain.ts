import { ELECTRS } from '../config'

/** Crude network guess from an address prefix (Bells testnet uses a `t…` prefix). */
function electrsBaseFor(address: string): string {
  return /^(t|m|n|2)/i.test(address) && /^tb/i.test(address) ? ELECTRS.testnet : ELECTRS.mainnet
}

export type BalanceResult = { bells: number } | { error: true }

/** Read the confirmed+unconfirmed $BELLS balance for an address via electrs
    (esplora-compatible). Returns BELLS (not sats). Never throws. */
export async function fetchBellsBalance(address: string): Promise<BalanceResult> {
  try {
    const res = await fetch(`${electrsBaseFor(address)}/address/${encodeURIComponent(address)}`)
    if (!res.ok) return { error: true }
    const j = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
    }
    const c = j.chain_stats ?? {}
    const m = j.mempool_stats ?? {}
    const sats =
      (c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0) + (m.funded_txo_sum ?? 0) - (m.spent_txo_sum ?? 0)
    return { bells: sats / 1e8 }
  } catch {
    return { error: true }
  }
}
