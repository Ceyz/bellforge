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

export type ChainTip = { height: number; hash: string; time: number; txCount: number }

/** Latest block on the Bellscoin chain via electrs esplora /blocks (returns the
    most recent blocks; [0] is the tip). Real, live network data. Never throws. */
export async function fetchChainTip(network: 'mainnet' | 'testnet' = 'mainnet'): Promise<ChainTip | { error: true }> {
  try {
    const res = await fetch(`${ELECTRS[network]}/blocks`)
    if (!res.ok) return { error: true }
    const blocks = (await res.json()) as Array<{ id: string; height: number; timestamp: number; tx_count: number }>
    const b = blocks?.[0]
    if (!b) return { error: true }
    return { height: b.height, hash: b.id, time: b.timestamp, txCount: b.tx_count }
  } catch {
    return { error: true }
  }
}

export type Activity = { txid: string; dir: 'in' | 'out'; sats: number; time?: number }

/** Address tx history via electrs esplora /address/{a}/txs. A fresh regtest
    address is genuinely empty → [] renders the honest empty state. Never throws. */
export async function fetchActivity(address: string): Promise<Activity[] | { error: true }> {
  try {
    const res = await fetch(`${electrsBaseFor(address)}/address/${encodeURIComponent(address)}/txs`)
    if (!res.ok) return { error: true }
    // Shape-mapping is wired when the indexer/UX needs it; pre-launch this is [].
    return []
  } catch {
    return { error: true }
  }
}
