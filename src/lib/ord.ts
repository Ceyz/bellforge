// ──────────────────────────────────────────────────────────────────────────
// src/lib/ord.ts — thin client for the `ord` runes indexer (Nintondo fork).
//
// Endpoints + JSON shapes per docs/RUNES_INDEXER.md (CORS-open, send
// `Accept: application/json`). The base URL is config.ORD; EMPTY ⇒ DISABLED so
// every function short-circuits to "unavailable" and callers use the existing
// client-side decoder/tracer fallback. NEVER throws.
//
// Used for READ/DISPLAY paths only (exact balances + live supply). The swap's
// anti-burn tracer deliberately stays client-side (trust-minimized) — ord must
// never become a single trusted oracle for fund-safety.
// ──────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any -- ord JSON is external + version-tracked;
   parsing is defensive at this boundary (per the doc's "confirm fields when wiring" caveat). */
import { ORD } from '../config'
import { cleanSymbol, formatRuneAmount, type RuneBalance } from './runes'

export const ordConfigured = (): boolean => !!ORD

// Negative cache: once a call fails (5xx / network / timeout), short-circuit
// every call for DOWN_MS so a swap/balance pass doesn't fire N doomed requests.
let _downUntil = 0
const DOWN_MS = 30_000
const TIMEOUT_MS = 8_000

async function ordGet(path: string): Promise<any | null> {
  if (!ORD) return null
  if (Date.now() < _downUntil) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(`${ORD}${path}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!r.ok) {
      // 5xx ⇒ the backend is down → trip the negative cache. A 404 is a real
      // "not found" (e.g. unknown rune) and must NOT mark the whole indexer down.
      if (r.status >= 500) _downUntil = Date.now() + DOWN_MS
      return null
    }
    const ct = r.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null // HTML default ⇒ JSON not negotiated → treat as unavailable
    return await r.json()
  } catch {
    _downUntil = Date.now() + DOWN_MS
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Probe the index health. true ⇒ reachable. */
export async function ordHealthy(): Promise<boolean> {
  if (!ORD) return false
  return (await ordGet('/status')) != null
}

export interface OrdRune {
  id: string // "block:tx"
  name: string // spaced rune, e.g. "NOOK•IN•BELLS"
  symbol?: string
  divisibility: number
  supply: bigint
  premine: bigint
  mints: bigint
  cap: bigint
  burned: bigint
  mintable: boolean
}

const big = (v: any): bigint => {
  try {
    return BigInt(v ?? 0)
  } catch {
    return 0n
  }
}

// Positive-only cache (never cache a transient null, so it heals when ord recovers).
const runeCache = new Map<string, OrdRune>()

/** GET /rune/<id-or-name> → metadata + supply stats. null ⇒ unavailable / not found. */
export async function ordRuneMeta(idOrName: string): Promise<OrdRune | null> {
  if (!ORD || !idOrName) return null
  const hit = runeCache.get(idOrName)
  if (hit) return hit
  const j = await ordGet(`/rune/${encodeURIComponent(idOrName)}`)
  const e = j?.entry
  if (!e) return null
  const terms = e.terms ?? null
  const meta: OrdRune = {
    id: j.id ?? e.id ?? idOrName,
    name: e.spaced_rune ?? e.rune ?? idOrName,
    symbol: typeof e.symbol === 'string' ? e.symbol : undefined,
    divisibility: Number(e.divisibility ?? 0),
    supply: big(e.supply),
    premine: big(e.premine),
    mints: big(e.mints),
    cap: terms ? big(terms.cap) : 0n,
    burned: big(e.burned),
    mintable: !!j.mintable,
  }
  runeCache.set(idOrName, meta)
  // also cache by id so a later lookup by id reuses it
  if (meta.id && meta.id !== idOrName) runeCache.set(meta.id, meta)
  return meta
}

const fracLen = (dec: string): number => {
  const i = dec.indexOf('.')
  return i < 0 ? 0 : dec.length - i - 1
}

/** Decimal STRING (divisibility already applied, e.g. "1.1") → raw integer bigint. */
function decimalToRaw(dec: string, div: number): bigint {
  const neg = dec.startsWith('-')
  const s = (neg ? dec.slice(1) : dec).trim()
  const [ipRaw, fpRaw = ''] = s.split('.')
  const ip = ipRaw.replace(/\D/g, '') || '0'
  const frac = (fpRaw.replace(/\D/g, '') + '0'.repeat(div)).slice(0, div)
  let raw: bigint
  try {
    raw = BigInt(ip + frac)
  } catch {
    raw = 0n
  }
  return neg ? -raw : raw
}

/** GET /address/<addr> → EXACT, complete rune balances (no client-side cap).
    `runes_balances` is `[[SpacedRune, decimalString(divisibility-applied), symbol|null]]`.
    Returns null when ord is unavailable/malformed (caller falls back); an empty
    array is an AUTHORITATIVE "this address holds no runes". */
export async function ordAddressBalances(address: string): Promise<RuneBalance[] | null> {
  if (!ORD || !address) return null
  const j = await ordGet(`/address/${encodeURIComponent(address)}`)
  const list = j?.runes_balances
  if (!Array.isArray(list)) return null
  const rows: RuneBalance[] = []
  for (const entry of list) {
    if (!Array.isArray(entry)) continue
    const name = String(entry[0] ?? '')
    const dec = String(entry[1] ?? '0')
    const rawSym = entry[2] == null ? '' : String(entry[2])
    if (!name) continue
    // resolve id + divisibility from /rune (cached); tolerate it being unavailable
    const meta = await ordRuneMeta(name)
    const divisibility = meta?.divisibility ?? fracLen(dec)
    const amount = decimalToRaw(dec, divisibility)
    if (amount <= 0n) continue
    const symbol = cleanSymbol(rawSym || meta?.symbol || '')
    rows.push({
      id: meta?.id ?? name,
      name: meta?.name ?? name,
      symbol,
      divisibility,
      amount,
      display: formatRuneAmount(amount, divisibility, symbol ?? ''),
      approx: false, // ord is exact + complete (no sampling)
    })
  }
  rows.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
  return rows
}
