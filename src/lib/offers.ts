import { RELAY } from '../config'

/** A rune-swap offer from the relay (a partial SINGLE|ACP PSBT + metadata). The
    relay is a dumb board — a taker must re-trace the rune UTXO + re-validate the
    signature before completing (done by the operator tooling / a future take flow). */
export type Offer = {
  id: string
  rune_id: string
  rune_utxo: string
  amount_hint?: string | null
  price: number
  seller_addr: string
  psbt: string
  created_at: number
}

export type OffersResult = { offers: Offer[] } | { error: true } | { unconfigured: true }

/** A settled trade (a taken offer) — the real fill history behind a rune's price. */
export type Fill = { rune_id: string; amount_hint?: string | null; price: number; seller_addr: string; created_at: number }
export type FillsResult = { fills: Fill[] } | { error: true } | { unconfigured: true }

export async function fetchFills(rune?: string): Promise<FillsResult> {
  if (!RELAY) return { unconfigured: true }
  try {
    const res = await fetch(`${RELAY}/fills${rune ? `?rune=${encodeURIComponent(rune)}` : ''}`)
    if (!res.ok) return { error: true }
    const j = (await res.json()) as { fills?: Fill[] }
    return { fills: j.fills ?? [] }
  } catch {
    return { error: true }
  }
}

export async function fetchOffers(rune?: string): Promise<OffersResult> {
  if (!RELAY) return { unconfigured: true }
  try {
    const res = await fetch(`${RELAY}/offers${rune ? `?rune=${encodeURIComponent(rune)}` : ''}`)
    if (!res.ok) return { error: true }
    const j = (await res.json()) as { offers?: Offer[] }
    return { offers: j.offers ?? [] }
  } catch {
    return { error: true }
  }
}

/** The open offers posted by one address (client-side filter on the public board). */
export async function fetchMyOffers(address: string): Promise<OffersResult> {
  const r = await fetchOffers()
  if ('offers' in r) return { offers: r.offers.filter((o) => o.seller_addr === address) }
  return r
}

/** Delist an offer (the seller cancels). Returns ok/false — never throws. */
export async function cancelOffer(id: string): Promise<boolean> {
  if (!RELAY) return false
  try {
    const res = await fetch(`${RELAY}/offers/${id}/cancel`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}
