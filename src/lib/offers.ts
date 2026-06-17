import { RELAY, ELECTRS } from '../config'

const API = ELECTRS.mainnet

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

/** Drop offers whose rune UTXO is already spent on-chain (immediate board cleanliness,
    independent of the relay's prune cron). On any electrs blip we KEEP the offer — the
    take/sweep re-traces + the broadcast would fail anyway, so this is only cosmetic. */
export async function filterLiveOffers(offers: Offer[]): Promise<Offer[]> {
  const checked = await Promise.all(
    offers.map(async (o) => {
      const [txid, vout] = o.rune_utxo.split(':')
      if (!txid || vout == null) return o
      try {
        const r = await fetch(`${API}/tx/${txid}/outspend/${vout}`)
        if (!r.ok) return o
        const j = (await r.json()) as { spent?: boolean }
        return j?.spent ? null : o
      } catch {
        return o
      }
    }),
  )
  return checked.filter((o): o is Offer => o !== null)
}

// Per-offer cancel token (ownership proof), kept in localStorage by the device that posted.
const cancelKey = (id: string) => `bf:cancel:${id}`
export function saveCancelToken(id: string, token: string): void {
  try {
    localStorage.setItem(cancelKey(id), token)
  } catch {
    /* private mode / storage off */
  }
}
export function getCancelToken(id: string): string | null {
  try {
    return localStorage.getItem(cancelKey(id))
  } catch {
    return null
  }
}

/** Delist an offer (the seller cancels). Sends the per-offer cancel token (ownership proof)
    so only the device that listed it can cancel. Returns ok/false — never throws. A `false`
    likely means "no token on this device" → cancel from where you listed (or spend the UTXO). */
export async function cancelOffer(id: string): Promise<boolean> {
  if (!RELAY) return false
  try {
    const token = getCancelToken(id) ?? ''
    const res = await fetch(`${RELAY}/offers/${id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    if (res.ok) {
      try {
        localStorage.removeItem(cancelKey(id))
      } catch {
        /* ignore */
      }
    }
    return res.ok
  } catch {
    return false
  }
}
