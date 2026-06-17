// ──────────────────────────────────────────────────────────────────────────
// src/lib/runes.ts — client-side RUNE balances on Bellscoin (NO indexer, NO node).
// electrs (esplora) for tx/UTXO data + runelib for decoding runestones.
//
// Scope (v1, best-effort, NEVER throws): for an address, sum the runes its CURRENT
// UTXOs received in their own creating tx (mint→pointer, simple edict→output).
// Out of scope (needs a full index → shown "—" in the UI): global holders/supply,
// full multi-tx edict lineage, cenotaph detection. Big mass-mint wallets exceed the
// electrs 1000-UTXO cap + are sampled here → results are a HONEST LOWER BOUND
// (`capped:true` → the UI shows "≥"). For a normal rune wallet the result is exact.
//
// runelib is CJS + needs a global Buffer (polyfilled in main.tsx) and pulls in
// bitcoinjs-lib; both are DYNAMICALLY imported so they stay out of the main bundle.
// ──────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any -- runelib + bitcoinjs-lib are untyped
   CJS, loaded via dynamic import(); `any` is the deliberate interop boundary (the Lib type). */
import { ELECTRS } from '../config'

const API = ELECTRS.mainnet
const MAX_TXS = 80 // cap distinct creating-txs we decode (bounds requests on mega-wallets)
const CONCURRENCY = 10

export type RuneIdStr = string

export interface RuneMeta {
  id: RuneIdStr
  name: string
  display: string
  symbol: string
  divisibility: number
  perMintAmount: bigint
  cap: bigint
  premine: bigint
  reserved: boolean
}

export interface RuneBalance {
  id: RuneIdStr
  name: string
  symbol?: string
  divisibility: number
  amount: bigint
  display: string
  /** true when the wallet was sampled/capped → `amount` is a lower bound (UI shows "≥"). */
  approx?: boolean
}

export type RuneBalancesResult = { rows: RuneBalance[]; capped: boolean } | { error: true }

export interface DecodedStone {
  mint: RuneIdStr | null
  pointer: number | null
  etching: EtchingView | null
  edicts: { id: RuneIdStr; amount: bigint; output: number }[]
}
interface EtchingView {
  name: string | null
  display: string | null
  symbol: string
  divisibility: number
  premine: bigint
  perMintAmount: bigint
  cap: bigint
}

// ── lazy lib loader (keeps runelib + bitcoinjs out of the main chunk) ─────────
type Lib = { R: any; Rune: any; applySpacers: any; bitcoin: any }
let _lib: Promise<Lib> | null = null
function getLib(): Promise<Lib> {
  if (_lib) return _lib
  _lib = (async () => {
    const rmod: any = await import('runelib')
    const bmod: any = await import('bitcoinjs-lib')
    const r = rmod.default ?? rmod
    return {
      R: r.Runestone ?? rmod.Runestone,
      Rune: r.Rune ?? rmod.Rune,
      applySpacers: r.applySpacers ?? rmod.applySpacers,
      bitcoin: bmod.default ?? bmod,
    }
  })()
  return _lib
}

/** Unwrap a runelib Option (None→null, Some<T>→T), tolerating raw values + _value. */
function ov(x: any): any {
  if (x == null) return null
  if (typeof x.value === 'function') return x.value()
  if (typeof x === 'object' && '_value' in x) return x._value
  return x
}
const toBig = (n: any): bigint => {
  try {
    if (typeof n === 'bigint') return n
    return BigInt(Math.trunc(Number(n ?? 0)))
  } catch {
    return 0n
  }
}

function etchingView(e: any, lib: Lib): EtchingView | null {
  try {
    const rune = ov(e.rune)
    const name: string | null = rune ? (rune.name ?? null) : null
    const spacers = Number(ov(e.spacers) ?? 0)
    const display = name ? safe(() => lib.applySpacers(name, spacers), name) : null
    const terms = ov(e.terms)
    return {
      name,
      display,
      symbol: ov(e.symbol) || '¤',
      divisibility: Number(ov(e.divisibility) ?? 0),
      premine: toBig(ov(e.premine)),
      perMintAmount: terms ? toBig(ov(terms.amount)) : 0n,
      cap: terms ? toBig(ov(terms.cap)) : 0n,
    }
  } catch {
    return null
  }
}
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Re-parse edicts from the runestone integers (runelib mis-decodes ≥2 edicts). */
function reparseEdicts(rawTxHex: string, lib: Lib): { id: RuneIdStr; amount: bigint; output: number }[] {
  try {
    const tx = lib.bitcoin.Transaction.fromHex(rawTxHex)
    const payloadOpt = lib.R.payload(tx)
    if (!payloadOpt?.isSome?.()) return []
    const intsOpt = lib.R.integers(payloadOpt.value())
    const ints: bigint[] = intsOpt?.value?.() ?? []
    let i = 0
    let inBody = false
    const body: bigint[] = []
    while (i < ints.length) {
      if (!inBody) {
        if (ints[i] === 0n) {
          inBody = true
          i += 1
          continue
        }
        i += 2
      } else {
        body.push(ints[i])
        i += 1
      }
    }
    const edicts: { id: RuneIdStr; amount: bigint; output: number }[] = []
    let block = 0n
    let idx = 0n
    for (let j = 0; j + 4 <= body.length; j += 4) {
      const [bDelta, tField, amount, output] = body.slice(j, j + 4)
      if (bDelta === 0n) idx += tField
      else {
        block += bDelta
        idx = tField
      }
      edicts.push({ id: `${block}:${idx}`, amount, output: Number(output) })
    }
    return edicts
  } catch {
    return []
  }
}

function decodeStone(rawTxHex: string, lib: Lib): DecodedStone | null {
  try {
    const opt = lib.R.decipher(rawTxHex)
    if (!opt?.isSome?.()) return null
    const s = opt.value()
    const mint = ov(s.mint)
    const e = ov(s.etching)
    const hasEtch = e && typeof e === 'object' && (e.rune || e.terms || e.divisibility != null)
    return {
      mint: mint && mint.block != null ? `${mint.block}:${mint.idx}` : null,
      pointer: typeof ov(s.pointer) === 'number' ? Number(ov(s.pointer)) : null,
      etching: hasEtch ? etchingView(e, lib) : null,
      edicts: reparseEdicts(rawTxHex, lib),
    }
  } catch {
    return null // malformed runestone, or missing Buffer polyfill
  }
}

/** Public: decode a runestone from full raw tx hex. null = no runestone / undecodable. */
export async function decodeRunestone(rawTxHex: string): Promise<DecodedStone | null> {
  const lib = await getLib()
  return decodeStone(rawTxHex, lib)
}

// ── RuneId → metadata (cached; reserved 1:0 = NINTONDO hardcoded) ─────────────
const RESERVED: Record<RuneIdStr, RuneMeta> = {
  '1:0': {
    id: '1:0',
    name: 'NINTONDO',
    display: 'NINTONDO',
    symbol: '¤',
    divisibility: 0,
    perMintAmount: 1n, // RuneMint mints 1 unit/tx; reserved rune (no etch on chain)
    cap: 0n,
    premine: 0n,
    reserved: true,
  },
}
const metaCache = new Map<RuneIdStr, RuneMeta>()

export async function resolveRune(id: RuneIdStr): Promise<RuneMeta> {
  const hit = metaCache.get(id)
  if (hit) return hit
  if (RESERVED[id]) {
    metaCache.set(id, RESERVED[id])
    return RESERVED[id]
  }
  const fallback: RuneMeta = { id, name: id, display: id, symbol: '¤', divisibility: 0, perMintAmount: 0n, cap: 0n, premine: 0n, reserved: false }
  try {
    const [block, idx] = id.split(':').map(Number)
    const hash = (await fetch(`${API}/block-height/${block}`).then((r) => r.text())).trim()
    const start = Math.floor(idx / 25) * 25
    const page = (await fetch(`${API}/block/${hash}/txs/${start}`).then((r) => r.json())) as { txid: string }[]
    const txid = page[idx - start]?.txid
    if (!txid) {
      metaCache.set(id, fallback)
      return fallback
    }
    const hex = await fetch(`${API}/tx/${txid}/hex`).then((r) => r.text())
    const lib = await getLib()
    const e = decodeStone(hex, lib)?.etching
    if (!e) {
      metaCache.set(id, fallback)
      return fallback
    }
    const meta: RuneMeta = {
      id,
      name: e.name ?? id,
      display: e.display ?? e.name ?? id,
      symbol: e.symbol || '¤',
      divisibility: e.divisibility,
      perMintAmount: e.perMintAmount,
      cap: e.cap,
      premine: e.premine,
      reserved: false,
    }
    metaCache.set(id, meta)
    return meta
  } catch {
    metaCache.set(id, fallback)
    return fallback
  }
}

// ── allocation (read-only subset of the Runes spec) ──────────────────────────
export function allocate(outs: { script: Uint8Array }[], stone: DecodedStone, mintPerMint: bigint): Map<number, Map<RuneIdStr, bigint>> {
  const numOuts = outs.length
  const isOpReturn = (k: number) => outs[k]?.script?.[0] === 0x6a
  const eligible: number[] = []
  for (let k = 0; k < numOuts; k++) if (!isOpReturn(k)) eligible.push(k)

  const unalloc = new Map<RuneIdStr, bigint>()
  const add = (m: Map<RuneIdStr, bigint>, id: RuneIdStr, amt: bigint) => m.set(id, (m.get(id) ?? 0n) + amt)

  if (stone.mint && mintPerMint > 0n) add(unalloc, stone.mint, mintPerMint)

  const out = new Map<number, Map<RuneIdStr, bigint>>()
  const slot = (k: number) => {
    let m = out.get(k)
    if (!m) {
      m = new Map()
      out.set(k, m)
    }
    return m
  }

  for (const ed of stone.edicts) {
    const have = unalloc.get(ed.id) ?? 0n
    if (have <= 0n && ed.amount > 0n) continue
    if (ed.output === numOuts) {
      const n = eligible.length
      if (n === 0) continue
      if (ed.amount === 0n) {
        const base = have / BigInt(n)
        const R = have % BigInt(n)
        eligible.forEach((k, j) => add(slot(k), ed.id, base + (BigInt(j) < R ? 1n : 0n)))
        unalloc.set(ed.id, 0n)
      } else {
        for (const k of eligible) {
          const give = min(ed.amount, unalloc.get(ed.id) ?? 0n)
          add(slot(k), ed.id, give)
          unalloc.set(ed.id, (unalloc.get(ed.id) ?? 0n) - give)
        }
      }
    } else {
      if (ed.output < 0 || ed.output >= numOuts || isOpReturn(ed.output)) continue
      const give = ed.amount === 0n ? have : min(ed.amount, have)
      add(slot(ed.output), ed.id, give)
      unalloc.set(ed.id, have - give)
    }
  }

  const pointerOut = stone.pointer != null ? stone.pointer : eligible.length ? eligible[0] : null
  if (pointerOut != null && pointerOut < numOuts && !isOpReturn(pointerOut)) {
    for (const [id, amt] of unalloc) if (amt > 0n) add(slot(pointerOut), id, amt)
  }
  return out
}
const min = (a: bigint, b: bigint) => (a < b ? a : b)

// ── formatting ───────────────────────────────────────────────────────────────
function brokenSurrogate(s: string): boolean {
  return s.length === 1 && s.charCodeAt(0) >= 0xd800 && s.charCodeAt(0) <= 0xdfff
}
export function cleanSymbol(s: string): string | undefined {
  if (!s || brokenSurrogate(s)) return undefined
  return s
}
export function formatRuneAmount(amount: bigint, divisibility: number, symbol: string): string {
  const symPart = symbol && !brokenSurrogate(symbol) ? ` ${symbol}` : ''
  if (divisibility <= 0) return amount.toLocaleString() + symPart
  const neg = amount < 0n
  const digits = (neg ? -amount : amount).toString().padStart(divisibility + 1, '0')
  const intPart = digits.slice(0, digits.length - divisibility)
  const frac = digits.slice(digits.length - divisibility).replace(/0+$/, '')
  return (neg ? '-' : '') + BigInt(intPart).toLocaleString() + (frac ? '.' + frac : '') + symPart
}

// ── concurrency helper ───────────────────────────────────────────────────────
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit)
    out.push(...(await Promise.all(chunk.map(fn))))
  }
  return out
}

/** THE public entry point: an address's rune balances, client-side, best-effort. */
export async function fetchRuneBalances(address: string): Promise<RuneBalancesResult> {
  try {
    const utxos = (await fetch(`${API}/address/${encodeURIComponent(address)}/utxo`).then((r) => (r.ok ? r.json() : Promise.reject()))) as {
      txid: string
      vout: number
    }[]
    if (!Array.isArray(utxos)) return { error: true }
    if (utxos.length === 0) return { rows: [], capped: false }

    const byTx = new Map<string, number[]>()
    for (const u of utxos) {
      const arr = byTx.get(u.txid) ?? []
      arr.push(u.vout)
      byTx.set(u.txid, arr)
    }
    const txids = [...byTx.keys()]
    const capped = txids.length > MAX_TXS || utxos.length >= 1000
    const work = txids.slice(0, MAX_TXS)

    const lib = await getLib()
    const held = new Map<RuneIdStr, bigint>()

    await mapLimit(work, CONCURRENCY, async (txid) => {
      try {
        const hex = await fetch(`${API}/tx/${txid}/hex`).then((r) => r.text())
        const stone = decodeStone(hex, lib)
        if (!stone || (!stone.mint && stone.edicts.length === 0)) return
        const tx = lib.bitcoin.Transaction.fromHex(hex)
        const mintPerMint = stone.mint ? (await resolveRune(stone.mint)).perMintAmount : 0n
        const alloc = allocate(tx.outs, stone, mintPerMint)
        for (const vout of byTx.get(txid) ?? []) {
          const m = alloc.get(vout)
          if (!m) continue
          for (const [id, amt] of m) held.set(id, (held.get(id) ?? 0n) + amt)
        }
      } catch {
        /* skip this tx, never throw */
      }
    })

    const rows: RuneBalance[] = []
    for (const [id, amount] of held) {
      if (amount <= 0n) continue
      const meta = await resolveRune(id)
      const symbol = cleanSymbol(meta.symbol)
      rows.push({
        id,
        name: meta.display,
        symbol,
        divisibility: meta.divisibility,
        amount,
        display: formatRuneAmount(amount, meta.divisibility, meta.symbol),
        approx: capped || undefined,
      })
    }
    rows.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    return { rows, capped }
  } catch {
    return { error: true }
  }
}
