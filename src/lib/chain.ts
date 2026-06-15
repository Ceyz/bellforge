import { ELECTRS } from '../config'

/** Crude network guess from an address prefix (Bells testnet uses a `t…` prefix). */
function electrsBaseFor(address: string): string {
  return /^(t|m|n|2)/i.test(address) && /^tb/i.test(address) ? ELECTRS.testnet : ELECTRS.mainnet
}

export type BalanceResult = { bells: number; txCount: number } | { error: true }

/** Read the confirmed+unconfirmed $BELLS balance + tx count for an address via
    electrs (esplora-compatible). Returns BELLS (not sats). Never throws. */
export async function fetchBellsBalance(address: string): Promise<BalanceResult> {
  try {
    const res = await fetch(`${electrsBaseFor(address)}/address/${encodeURIComponent(address)}`)
    if (!res.ok) return { error: true }
    const j = (await res.json()) as {
      chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number }
      mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number; tx_count?: number }
    }
    const c = j.chain_stats ?? {}
    const m = j.mempool_stats ?? {}
    const sats =
      (c.funded_txo_sum ?? 0) - (c.spent_txo_sum ?? 0) + (m.funded_txo_sum ?? 0) - (m.spent_txo_sum ?? 0)
    return { bells: sats / 1e8, txCount: (c.tx_count ?? 0) + (m.tx_count ?? 0) }
  } catch {
    return { error: true }
  }
}

export type ChainTip = { height: number; hash: string; time: number; txCount: number }

/** Tiny shared cache so the footer + token page don't each re-hit electrs. */
const tipCache: Record<string, { at: number; tip: ChainTip }> = {}

/** Latest block on the Bellscoin chain via electrs esplora /blocks (returns the
    most recent blocks; [0] is the tip). Real, live network data. Cached ~20s.
    Never throws. */
export async function fetchChainTip(network: 'mainnet' | 'testnet' = 'mainnet'): Promise<ChainTip | { error: true }> {
  const cached = tipCache[network]
  if (cached && Date.now() - cached.at < 20_000) return cached.tip
  try {
    const res = await fetch(`${ELECTRS[network]}/blocks`)
    if (!res.ok) return { error: true }
    const blocks = (await res.json()) as Array<{ id: string; height: number; timestamp: number; tx_count: number }>
    const b = blocks?.[0]
    if (!b) return { error: true }
    const tip: ChainTip = { height: b.height, hash: b.id, time: b.timestamp, txCount: b.tx_count }
    tipCache[network] = { at: Date.now(), tip }
    return tip
  } catch {
    return { error: true }
  }
}

export type Activity = { txid: string; dir: 'in' | 'out'; sats: number; time?: number; confirmed: boolean }

/** Address tx history via electrs esplora /address/{a}/txs. Maps each tx to a
    net direction + amount for THIS address (received via vout − sent via vin
    prevouts). A fresh address is genuinely empty → [] (honest empty state).
    Never throws. */
export async function fetchActivity(address: string): Promise<Activity[] | { error: true }> {
  try {
    const res = await fetch(`${electrsBaseFor(address)}/address/${encodeURIComponent(address)}/txs`)
    if (!res.ok) return { error: true }
    const txs = (await res.json()) as Array<{
      txid: string
      status?: { confirmed?: boolean; block_time?: number }
      vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>
      vout?: Array<{ scriptpubkey_address?: string; value?: number }>
    }>
    return txs.slice(0, 12).map((t) => {
      const received = (t.vout ?? [])
        .filter((o) => o.scriptpubkey_address === address)
        .reduce((s, o) => s + (o.value ?? 0), 0)
      const sent = (t.vin ?? [])
        .filter((i) => i.prevout?.scriptpubkey_address === address)
        .reduce((s, i) => s + (i.prevout?.value ?? 0), 0)
      const net = received - sent
      return {
        txid: t.txid,
        dir: net >= 0 ? 'in' : 'out',
        sats: Math.abs(net),
        time: t.status?.block_time,
        confirmed: !!t.status?.confirmed,
      }
    })
  } catch {
    return { error: true }
  }
}
