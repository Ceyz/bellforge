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
