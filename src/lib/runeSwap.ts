// ──────────────────────────────────────────────────────────────────────────
// src/lib/runeSwap.ts — BROWSER side of the rune atomic swap (the buyer / TAKE).
// Mirrors the proven operator tooling (tools/rune-swap.mjs + runes-lib.mjs):
//   * load the seller's partial SINGLE|ACP PSBT from the relay,
//   * INDEPENDENTLY trace the seller's rune UTXO (real content, never trust the hint),
//   * fund from a rune-FREE UTXO of the connected wallet (trace every candidate),
//   * add the runestone edict (FULL content -> buyer) + recv + change,
//   * ANTI-BURN GUARD + re-validate the seller's SINGLE|ACP signature,
//   * the WALLET signs only the buyer's plain-BELLS input (no rune UTXO is spent by
//     the buyer -> no burn risk); then finalize, guard the final tx, broadcast.
// bitcoinjs-lib + runelib are dynamically imported (kept out of the main bundle).
// Buffer is polyfilled in main.tsx.
// ──────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any -- bitcoinjs-lib + runelib are untyped
   CJS, loaded via dynamic import(); `any` is the deliberate interop boundary (the Lib type). */
import { ELECTRS } from '../config'
import type { Offer } from './offers'
import { resolveRune, formatRuneAmount, cleanSymbol, type RuneBalancesResult, type RuneBalance } from './runes'
import { ordAddressBalances } from './ord'

const API = ELECTRS.mainnet
const DUST = 546

// Bounded fetch (timeout + r.ok) so a hung/erroring electrs can't stall the tracer or
// silently feed an error body into a decode. Throws on timeout / non-2xx.
async function fetchJson(url: string, ms = 12000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}
async function fetchText(url: string, ms = 12000): Promise<string> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(t)
  }
}

/** Pre-broadcast safety: is this outpoint still unspent on-chain? Avoids broadcasting a tx
    whose seller rune input was already spent (front-run/race) — saves a doomed broadcast.
    On an electrs blip we DON'T block (the node rejects a double-spend anyway). */
async function isUnspent(txid: string, vout: number): Promise<boolean> {
  try {
    const j = await fetchJson(`${API}/tx/${txid}/outspend/${vout}`)
    return j?.spent !== true
  } catch {
    return true
  }
}
// Bellscoin mainnet params for bitcoinjs-lib (bech32 'bel', wif 0x99).
const BELLS = {
  messagePrefix: '\x18Bells Signed Message:\n',
  bech32: 'bel',
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 25,
  scriptHash: 30,
  wif: 0x99,
}

type Lib = { b: any; Runestone: any; Edict: any; RuneId: any; none: any; Message: any }
let _lib: Promise<Lib> | null = null
function getLib(): Promise<Lib> {
  if (_lib) return _lib
  _lib = (async () => {
    const bmod: any = await import('bitcoinjs-lib')
    const rmod: any = await import('runelib')
    const eccmod: any = await import('@bitcoinerlab/secp256k1')
    const b = bmod.default ?? bmod
    // @bitcoinerlab/secp256k1 is pure-CJS: the TinySecp256k1 interface is the namespace
    // (isXOnlyPoint / xOnlyPointAddTweak live on the object itself, no real `default`).
    // Without this, address.toOutputScript on a taproot (bel1p) address throws
    // "No ECC Library provided. You must call initEccLib()". Idempotent + safe for segwit.
    const ecc = eccmod.isXOnlyPoint ? eccmod : (eccmod.default ?? eccmod)
    b.initEccLib(ecc)
    const r = rmod.default ?? rmod
    return { b, Runestone: r.Runestone ?? rmod.Runestone, Edict: r.Edict ?? rmod.Edict, RuneId: r.RuneId ?? rmod.RuneId, none: r.none ?? rmod.none, Message: r.Message ?? rmod.Message }
  })()
  return _lib
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b)

const ov = (x: any): any => (x == null ? null : typeof x.value === 'function' ? x.value() : '_value' in x ? x._value : x)

type Edict = { id: string; amount: bigint; output: number }

/** Re-derive edicts from the runestone integers. runelib mis-decodes a runestone with >=2
    edicts (the deltas), so the lineage tracer can mis-credit on a multi-edict tx — port the
    same fix runes.ts uses. Casey body format: after the 0 separator, 4 ints per edict
    (block-delta, tag/idx-field, amount, output) with running (block,idx). */
function reparseEdicts(rawTxHex: string, lib: Lib): Edict[] {
  try {
    const tx = lib.b.Transaction.fromHex(rawTxHex)
    const payloadOpt = lib.Runestone.payload(tx)
    if (!payloadOpt?.isSome?.()) return []
    const intsOpt = lib.Runestone.integers(payloadOpt.value())
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
    const edicts: Edict[] = []
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

type Stone = { mint: string | null; pointer: number | null; edicts: Edict[]; cenotaph: boolean }
function decodeStone(hex: string, lib: Lib): Stone | null {
  let opt: any
  try {
    opt = lib.Runestone.decipher(hex)
  } catch {
    return null
  }
  if (!opt?.isSome?.()) return null
  const s = opt.value()
  const mint = ov(s.mint)
  // edicts via reparseEdicts (runelib mis-decodes >=2); mint/pointer from decipher are fine.
  const edicts = reparseEdicts(hex, lib)
  const ptr = ov(s.pointer)
  // CENOTAPH: Runestone.decipher() DROPS Message.flaws, so a cenotaph (a runestone with a
  // decode flaw — out-of-range edict, supply overflow, unrecognized even tag, …) is silently
  // returned as a normal runestone. Recompute the Message and check its flaws; a cenotaph
  // BURNS every rune in the tx, so allocate() must route nothing to the outputs.
  let cenotaph = false
  try {
    const tx = lib.b.Transaction.fromHex(hex)
    const payloadOpt = lib.Runestone.payload(tx)
    if (payloadOpt?.isSome?.()) {
      const intsOpt = lib.Runestone.integers(payloadOpt.value())
      const msg = lib.Message.from_integers(tx, intsOpt.value())
      if (msg && Number(msg.flaws ?? 0) !== 0) cenotaph = true
    }
  } catch {
    /* can't recompute flaws → trust decipher's view (not a cenotaph) */
  }
  return { mint: mint && mint.block != null ? `${mint.block}:${mint.idx}` : null, pointer: typeof ptr === 'number' ? ptr : null, edicts, cenotaph }
}

/** Allocate input runes (+ a mint of `mintPerMint`) across the tx outputs per the runestone.
    `mintPerMint` is resolved per-rune by the caller (NOT a hardcoded map) so etched runes with
    real Terms (e.g. NOOK) are credited correctly. A cenotaph burns everything. */
function allocate(outScripts: Uint8Array[], stone: Stone | null, inputRunes: Map<string, bigint>, mintPerMint = 0n) {
  const n = outScripts.length
  const isOR = (k: number) => outScripts[k]?.[0] === 0x6a
  const elig: number[] = []
  for (let k = 0; k < n; k++) if (!isOR(k)) elig.push(k)
  const un = new Map(inputRunes)
  const out = new Map<number, Map<string, bigint>>()
  const burned = new Map<string, bigint>()
  const add = (m: Map<string, bigint>, id: string, a: bigint) => m.set(id, (m.get(id) ?? 0n) + a)
  const slot = (k: number) => out.get(k) ?? out.set(k, new Map()).get(k)!
  if (stone?.mint && mintPerMint > 0n) add(un, stone.mint, mintPerMint)
  // a cenotaph burns ALL runes in the tx (input + any mint) — nothing reaches the outputs
  if (stone?.cenotaph) {
    for (const [id, a] of un) if (a > 0n) burned.set(id, a)
    return { out, burned }
  }
  if (stone) {
    for (const ed of stone.edicts) {
      const have = un.get(ed.id) ?? 0n
      if (have <= 0n && ed.amount > 0n) continue
      if (ed.output === n) {
        // output == numOuts ⇒ distribute to EVERY eligible output (Casey "split")
        const m = elig.length
        if (m === 0) continue
        if (ed.amount === 0n) {
          const base = have / BigInt(m)
          const rem = have % BigInt(m)
          elig.forEach((k, j) => add(slot(k), ed.id, base + (BigInt(j) < rem ? 1n : 0n)))
          un.set(ed.id, 0n)
        } else {
          for (const k of elig) {
            const give = min(ed.amount, un.get(ed.id) ?? 0n)
            add(slot(k), ed.id, give)
            un.set(ed.id, (un.get(ed.id) ?? 0n) - give)
          }
        }
      } else {
        if (ed.output < 0 || ed.output >= n || isOR(ed.output)) continue
        const g = ed.amount === 0n ? have : ed.amount < have ? ed.amount : have
        add(slot(ed.output), ed.id, g)
        un.set(ed.id, have - g)
      }
    }
  }
  const ptr = stone && stone.pointer != null ? stone.pointer : elig.length ? elig[0] : null
  if (ptr != null && ptr < n && !isOR(ptr)) for (const [id, a] of un) { if (a > 0n) add(slot(ptr), id, a) }
  else for (const [id, a] of un) if (a > 0n) burned.set(id, a)
  return { out, burned }
}

/** Trace the REAL rune content of a UTXO (bounded lineage replay). null = unknown. */
async function makeTracer(lib: Lib) {
  let fetches = 0
  const memo = new Map<string, Map<string, bigint> | null>()
  async function trace(txid: string, vout: number, depth = 0): Promise<Map<string, bigint> | null> {
    const key = `${txid}:${vout}`
    if (memo.has(key)) return memo.get(key)!
    if (depth > 40 || fetches > 800) return null
    fetches++
    let txj: any
    let hex: string
    try {
      txj = await fetchJson(`${API}/tx/${txid}`)
    } catch {
      memo.set(key, null) // electrs hung/errored → refuse (never mis-trace)
      return null
    }
    if (txj.vin?.[0]?.is_coinbase) {
      memo.set(key, new Map())
      return new Map()
    }
    try {
      hex = await fetchText(`${API}/tx/${txid}/hex`)
    } catch {
      memo.set(key, null)
      return null
    }
    const stone = decodeStone(hex, lib)
    const inR = new Map<string, bigint>()
    if (stone)
      for (const vin of txj.vin || []) {
        const r = await trace(vin.txid, vin.vout, depth + 1)
        if (r === null) {
          memo.set(key, null)
          return null
        }
        for (const [id, a] of r) inR.set(id, (inR.get(id) ?? 0n) + a)
      }
    // resolve the mint's per-mint amount from its etching Terms (NOT a hardcoded map), so an
    // etched rune (NOOK) is credited right; reserved 1:0=NINTONDO is 1 (resolveRune is cached).
    const mintPerMint = stone?.mint ? (await resolveRune(stone.mint)).perMintAmount : 0n
    const outScripts = lib.b.Transaction.fromHex(hex).outs.map((o: any) => o.script)
    const res = allocate(outScripts, stone, inR, mintPerMint).out.get(vout) ?? new Map()
    memo.set(key, res)
    return res
  }
  return trace
}

export type TakePlan = {
  psbtB64: string // base64 PSBT — the format Nintondo signPsbt expects (hex → "Invalid Magic Number")
  buyerInputIndex: number
  runeTxid: string
  runeVout: number
  runeId: string
  runeName: string
  amount: bigint
  price: number // sats the buyer pays the seller
  fee: number
  change: number
  sellerAddr: string
  fundingUtxo: string
  taproot: boolean // buyer funding input is a P2TR keyspend (sign with SIGHASH_DEFAULT) vs P2WPKH (SIGHASH_ALL)
}

const NAMES: Record<string, string> = { '1:0': 'NINTONDO', '350000:1': 'NOOK•IN•BELLS' }

// Bellscoin Runes are MAINNET-only (no testnet runes); a tb-prefixed address would otherwise
// be served wrong (mainnet) electrs data, so reject it explicitly instead.
const MAINNET_ONLY = 'Bellscoin Runes are mainnet-only — connect a bel1… mainnet address.'
const isTestnetAddr = (a: string) => /^tb/i.test(a || '')

/** Pre-sign binding check (defense-in-depth + refuse-before-sign UX). The seller's 0x83 sig
    already commits input0's outpoint (ANYONECANPAY) + output0's value/script (SINGLE), so a
    relay/MITM that tampers either yields an invalid sig → node-reject → no loss. We verify it
    here so the wallet is never asked to sign a take that can't possibly settle: the offer PSBT
    is a bare input0→output0, signed 0x83, whose input == the advertised rune_utxo and whose
    output0 pays the advertised seller address. Returns null = OK, or an error string. */
function checkOfferBinding(psbt: any, offer: Offer, lib: Lib): string | null {
  if (psbt.txInputs.length !== 1 || psbt.txOutputs.length !== 1) return 'Offer is not a bare SINGLE|ACP listing.'
  const inp = psbt.data.inputs[0]
  if (!inp?.witnessUtxo) return 'Offer input is missing its witnessUtxo.'
  // sighash from the SIGNATURE byte (authoritative — wallets may drop the PSBT sighashType
  // field). P2WPKH seller → partialSig; taproot seller → tapKeySig (65B ending 0x83).
  let sh: number | null = null
  if (inp.partialSig?.length) {
    const s = inp.partialSig[0].signature
    sh = s[s.length - 1]
  } else if (inp.tapKeySig) {
    sh = inp.tapKeySig.length === 65 ? inp.tapKeySig[64] : (inp.sighashType ?? 0x00)
  }
  if (sh !== 0x83) return 'Offer is not signed SIGHASH_SINGLE|ANYONECANPAY (0x83).'
  const outpoint = `${Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex')}:${psbt.txInputs[0].index}`
  if (offer.rune_utxo && outpoint !== offer.rune_utxo) return 'Offer PSBT input does not match the advertised rune UTXO.'
  let payScript: Uint8Array
  try {
    payScript = lib.b.address.toOutputScript(offer.seller_addr, BELLS)
  } catch {
    return 'Offer seller address is invalid.'
  }
  if (Buffer.compare(Buffer.from(psbt.txOutputs[0].script), Buffer.from(payScript)) !== 0) return 'Offer payment output does not match the seller address.'
  // the relay's advertised price must equal the PSBT's committed payment (the price the seller
  // actually signed under SINGLE) — otherwise the board/sweep can bait with a fake price.
  if (offer.price != null && psbt.txOutputs[0].value !== offer.price) return 'Offer price does not match the signed payment output.'
  return null
}

/** Build the buyer's completion of an offer. Never throws — returns { error }.
    Does NOT sign or broadcast. The caller has the wallet sign buyerInputIndex
    (plain BELLS, SIGHASH_ALL), then calls finalizeAndBroadcast. */
export async function buildTake(offer: Offer, buyerAddress: string): Promise<TakePlan | { error: string }> {
  try {
    if (isTestnetAddr(buyerAddress)) return { error: MAINNET_ONLY }
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const psbt = lib.b.Psbt.fromBase64(offer.psbt, { network: BELLS })
    const bindErr = checkOfferBinding(psbt, offer, lib) // refuse a tampered/mismatched offer before signing
    if (bindErr) return { error: bindErr }
    const runeTxid = Buffer.from(psbt.txInputs[0].hash).reverse().toString('hex')
    const runeVout = psbt.txInputs[0].index
    const price = psbt.txOutputs[0].value
    const v0 = psbt.data.inputs[0].witnessUtxo?.value ?? 0

    // independently trace the seller's rune content (ignore the hint)
    const content = await trace(runeTxid, runeVout)
    if (content === null) return { error: 'Could not fully trace the seller rune UTXO — refusing.' }
    const keys = [...content.keys()]
    if (keys.length !== 1) return { error: `Seller UTXO holds ${keys.length} runes; only single-rune swaps are supported.` }
    const id = keys[0]
    if (offer.rune_id && id !== offer.rune_id) return { error: 'The traced rune does not match the advertised rune id.' }
    const amount = content.get(id)!

    // Classify the buyer address up front (fail fast on a legacy type, before the funding
    // scan). We support a Segwit v0 (P2WPKH, bel1q…) OR a Taproot keyspend (P2TR, bel1p…)
    // buyer. toOutputScript succeeds for taproot now that ECC is initialised in getLib().
    // This code never signs or finalises manually — the WALLET signs its own funding input
    // (ECDSA for p2wpkh, Schnorr keyspend for p2tr) and bitcoinjs finalizeInput auto-routes
    // by the input's witnessUtxo script type. The ONLY divergence is the wallet sighash
    // recipe (p2wpkh = SIGHASH_ALL; taproot keyspend = SIGHASH_DEFAULT), surfaced via
    // `taproot` so confirmTake passes the right toSignInputs. Legacy P2PKH/P2SH have no
    // witnessUtxo keyspend path → rejected cleanly.
    const buyerSpk = lib.b.address.toOutputScript(buyerAddress, BELLS)
    const isP2WPKH = buyerSpk.length === 22 && buyerSpk[0] === 0x00 && buyerSpk[1] === 0x14
    const isP2TR = buyerSpk.length === 34 && buyerSpk[0] === 0x51 && buyerSpk[1] === 0x20
    if (!isP2WPKH && !isP2TR)
      return {
        error:
          'Rune swaps need a Native SegWit (bel1q…) or Taproot (bel1p…) wallet address. Your wallet is connected with an unsupported legacy address type — switch the Nintondo account type and reconnect.',
      }

    // a rune-FREE funding UTXO of the buyer with enough sats
    const fee = 2000
    const need = Math.max(0, price + DUST + fee - v0) + 1000
    const utxos: any[] = await fetchJson(`${API}/address/${encodeURIComponent(buyerAddress)}/utxo`)
    let fund: any = null
    let scanned = 0
    for (const u of utxos) {
      if (scanned >= 60) break
      if (u.value < need) continue
      scanned++
      const c = await trace(u.txid, u.vout)
      if (c === null) continue
      if (c.size === 0) {
        fund = u
        break
      }
    }
    if (!fund) return { error: `No rune-free funding UTXO >= ${need} sats found in your wallet (need plain $BELLS).` }

    const [bk, ik] = id.split(':').map(Number)
    const stone = new lib.Runestone([new lib.Edict(new lib.RuneId(bk, ik), amount, 2)], lib.none(), lib.none(), lib.none())
    psbt.addInput({ hash: fund.txid, index: fund.vout, witnessUtxo: { script: buyerSpk, value: fund.value } })
    psbt.addOutput({ script: stone.encipher(), value: 0 }) // output 1
    psbt.addOutput({ script: buyerSpk, value: DUST }) // output 2 = buyer rune-receive
    let change = v0 + fund.value - price - DUST - fee
    let realFee = fee
    if (change >= DUST) psbt.addOutput({ script: buyerSpk, value: change })
    else {
      change = 0
      realFee = v0 + fund.value - price - DUST
    }
    if (realFee < 200) return { error: 'Funding UTXO too small after fees.' }

    // GUARD on the would-be outputs (no extraction needed yet). allocate() wants a
    // DECODED Stone ({mint,pointer,edicts:[{id:"block:idx",amount,output}]}) — feeding it
    // the raw runelib Runestone object misreads every field and false-flags a burn. Build
    // the decoded literal that mirrors exactly what stone.encipher() commits.
    const guardStone: Stone = { mint: null, pointer: null, edicts: [{ id, amount, output: 2 }], cenotaph: false }
    const outScripts: Uint8Array[] = psbt.txOutputs.map((o: any) => o.script)
    const g = allocate(outScripts, guardStone, content)
    if (g.burned.size) return { error: 'Guard: a rune would be burned. Refusing.' }
    if ((g.out.get(2)?.get(id) ?? 0n) !== amount) return { error: 'Guard: the rune would not all reach you. Refusing.' }
    if (g.out.get(0)?.get(id)) return { error: 'Guard: the seller would get the rune back. Refusing.' }

    return {
      psbtB64: psbt.toBase64(),
      buyerInputIndex: 1,
      runeTxid,
      runeVout,
      runeId: id,
      runeName: NAMES[id] ?? id,
      amount,
      price,
      fee: realFee,
      change,
      sellerAddr: offer.seller_addr,
      fundingUtxo: `${fund.txid}:${fund.vout}`,
      taproot: isP2TR,
    }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

/** Turn whatever the wallet hands back into a final raw-tx hex. Nintondo's signPsbt may
    return a PSBT (hex OR base64) with our input still un-finalized, OR a fully finalized
    raw tx hex (wallet doc point 7). We finalize only the inputs that still carry a
    partialSig (the seller's SINGLE|ACP input0 + the buyer's funding) — never re-finalize. */
function toFinalTxHex(signed: string, lib: Lib): string {
  const s = signed.trim()
  if (/^70736274ff/i.test(s) || /^cHNidP/.test(s)) {
    const psbt = /^cHNidP/.test(s) ? lib.b.Psbt.fromBase64(s, { network: BELLS }) : lib.b.Psbt.fromHex(s, { network: BELLS })
    psbt.data.inputs.forEach((inp: any, idx: number) => {
      if (!inp.finalScriptSig && !inp.finalScriptWitness) psbt.finalizeInput(idx)
    })
    return psbt.extractTransaction().toHex()
  }
  // already a finalized raw tx — parse-validate then use as-is
  lib.b.Transaction.fromHex(s)
  return s
}

/** Finalize whatever the wallet returned, re-run the anti-burn guard on the FINAL tx,
    then broadcast via electrs. Returns the txid or { error }. The guard is authoritative:
    it decodes the real tx and refuses unless the full rune lands on the buyer (output 2)
    with nothing burned — exactly the operator tool's assertSwapNoBurn. */
export async function finalizeAndBroadcast(signed: string, expect: { runeId: string; amount: bigint; runeTxid: string; runeVout: number }): Promise<{ txid: string } | { error: string }> {
  try {
    const lib = await getLib()
    const hex = toFinalTxHex(signed, lib)
    const tx = lib.b.Transaction.fromHex(hex)
    const trace = await makeTracer(lib)
    // Trace EVERY input of the FINAL signed tx (not just the expected seller). A malicious
    // wallet could swap the funding for a rune-bearing UTXO or splice in an extra rune input —
    // the guard must see the TRUE input runes, confirm the seller input is consumed, and that
    // no unexpected rune is present, before allocating against the real stone.
    const inSum = new Map<string, bigint>()
    let sawSeller = false
    for (const vin of tx.ins) {
      const itxid = Buffer.from(vin.hash).reverse().toString('hex')
      const ivout = vin.index
      if (itxid === expect.runeTxid && ivout === expect.runeVout) sawSeller = true
      const c = await trace(itxid, ivout)
      if (c === null) return { error: 'final guard: cannot trace a tx input — NOT broadcasting' }
      for (const [id, a] of c) inSum.set(id, (inSum.get(id) ?? 0n) + a)
    }
    if (!sawSeller) return { error: 'final guard: the seller rune input is not in the signed tx — NOT broadcasting' }
    for (const [id, a] of inSum) if (id !== expect.runeId && a > 0n) return { error: 'final guard: an unexpected rune is in the inputs — NOT broadcasting' }
    if ((inSum.get(expect.runeId) ?? 0n) !== expect.amount) return { error: 'final guard: input rune total changed — NOT broadcasting' }
    const stone = decodeStone(hex, lib)
    const outScripts = tx.outs.map((o: any) => o.script)
    const g = allocate(outScripts, stone, inSum)
    if (g.burned.size) return { error: 'final guard: rune would burn — NOT broadcasting' }
    if ((g.out.get(2)?.get(expect.runeId) ?? 0n) !== expect.amount) return { error: 'final guard: buyer would not receive the full rune — NOT broadcasting' }
    if (!(await isUnspent(expect.runeTxid, expect.runeVout))) return { error: 'The seller rune UTXO was already spent (front-run) — NOT broadcasting.' }
    const res = await fetch(`${API}/tx`, { method: 'POST', body: hex })
    const body = await res.text()
    if (!res.ok) return { error: `broadcast rejected: ${body}` }
    return { txid: body.trim() }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

// ── BATCHED sweep: take N offers in ONE tx (Magic-Eden msigner style) ────────────────
// INDEX-MIRRORED layout (the load-bearing rule, from the SINGLE|ACP sighash analysis):
//   inputs:  [seller_0 rune @0, seller_1 rune @1, …, seller_{n-1} rune @(n-1), buyer funding @n]
//   outputs: [pay_0 @0, pay_1 @1, …, pay_{n-1} @(n-1), runestone @n, buyer recv @(n+1), change @(n+2)]
// Each seller signed SINGLE|ACP at THEIR input index 0 → output 0 = their payment. BIP143's
// SINGLE hashOutputs commits to vout[nIn] (the input's FINAL index) and ANYONECANPAY drops the
// input-set commitment — so placing seller_k's input at index k AND their payment at output k
// makes the SAME sighash the seller signed (same outpoint + same paired output), keeping every
// seller sig valid. ONE runestone edicts the SUMMED traced amount to the buyer recv. The
// anti-burn guard runs on the COMBINED tx with the union of all traced contents.

export type BatchTakePlan = {
  psbtB64: string
  buyerInputIndex: number
  recvOut: number
  runeId: string
  runeName: string
  amount: bigint // summed across all offers
  offerCount: number
  totalPrice: number
  fee: number
  change: number
  taproot: boolean
  sellers: { txid: string; vout: number }[]
}

/** Build ONE tx that takes all `offers` (same rune). Never signs/broadcasts. The buyer signs
    only their funding input (index n); finalizeAndBroadcastBatch guards + broadcasts. */
export async function buildBatchTake(offers: Offer[], buyerAddress: string): Promise<BatchTakePlan | { error: string }> {
  try {
    if (offers.length === 0) return { error: 'No offers selected.' }
    if (isTestnetAddr(buyerAddress)) return { error: MAINNET_ONLY }
    const lib = await getLib()
    const trace = await makeTracer(lib)

    const buyerSpk = lib.b.address.toOutputScript(buyerAddress, BELLS)
    const isP2WPKH = buyerSpk.length === 22 && buyerSpk[0] === 0x00 && buyerSpk[1] === 0x14
    const isP2TR = buyerSpk.length === 34 && buyerSpk[0] === 0x51 && buyerSpk[1] === 0x20
    if (!isP2WPKH && !isP2TR) return { error: 'Your wallet address type is unsupported (need bel1q… or bel1p…).' }

    // independently trace + validate every offer; they must all be the SAME single rune
    let runeId: string | null = null
    let totalAmount = 0n
    let totalPrice = 0
    let totalInVal = 0
    const sellerIns: { hash: string; index: number; witnessUtxo: any; sign: any }[] = []
    const sellerOuts: { script: Uint8Array; value: number }[] = []
    const sellers: { txid: string; vout: number }[] = []
    for (const offer of offers) {
      const p = lib.b.Psbt.fromBase64(offer.psbt, { network: BELLS })
      const bindErr = checkOfferBinding(p, offer, lib) // outpoint==advertised, output0==seller, 0x83, witnessUtxo
      if (bindErr) return { error: `Offer ${offer.id?.slice(0, 8) ?? ''}: ${bindErr}` }
      const txid = Buffer.from(p.txInputs[0].hash).reverse().toString('hex')
      const vout = p.txInputs[0].index
      const content = await trace(txid, vout)
      if (content === null) return { error: 'Could not fully trace a seller rune UTXO — refusing the sweep.' }
      const keys = [...content.keys()]
      if (keys.length !== 1) return { error: 'A seller UTXO holds multiple runes — not sweepable.' }
      const id = keys[0]
      if (offer.rune_id && id !== offer.rune_id) return { error: 'A traced rune does not match its advertised rune id.' }
      if (runeId === null) runeId = id
      else if (id !== runeId) return { error: 'The sweep mixes different runes.' }
      totalAmount += content.get(id)!
      const inp = p.data.inputs[0]
      const wu = inp.witnessUtxo
      if (!wu) return { error: 'A selected offer is missing its witnessUtxo.' }
      totalInVal += wu.value
      totalPrice += p.txOutputs[0].value
      // carry the seller's signature fields (P2WPKH partialSig, or taproot tapKeySig)
      const sign: any = {}
      if (inp.partialSig) sign.partialSig = inp.partialSig
      if (inp.tapKeySig) sign.tapKeySig = inp.tapKeySig
      if (inp.tapInternalKey) sign.tapInternalKey = inp.tapInternalKey
      if (inp.sighashType != null) sign.sighashType = inp.sighashType
      sellerIns.push({ hash: txid, index: vout, witnessUtxo: wu, sign })
      sellerOuts.push({ script: p.txOutputs[0].script, value: p.txOutputs[0].value })
      sellers.push({ txid, vout })
    }
    if (!runeId) return { error: 'No rune resolved.' }

    // a rune-FREE funding UTXO covering: Σprice + recv dust + fee − Σ(seller input values)
    const n = offers.length
    const fee = 1000 + n * 700 // grows with tx size
    const need = Math.max(0, totalPrice + DUST + fee - totalInVal) + 1000
    const utxos: any[] = await fetchJson(`${API}/address/${encodeURIComponent(buyerAddress)}/utxo`)
    let fund: any = null
    let scanned = 0
    for (const u of utxos) {
      if (scanned >= 60 || fund) break
      if (u.value < need) continue
      scanned++
      const c = await trace(u.txid, u.vout)
      if (c !== null && c.size === 0) fund = u
    }
    if (!fund) return { error: `No rune-free funding UTXO ≥ ${need} sats in your wallet for a ${n}-offer sweep.` }

    // assemble — index-mirrored
    const psbt = new lib.b.Psbt({ network: BELLS })
    sellerIns.forEach((si, k) => {
      psbt.addInput({ hash: si.hash, index: si.index, witnessUtxo: si.witnessUtxo, sighashType: si.sign.sighashType ?? 0x83 })
      const upd: any = {}
      if (si.sign.partialSig) upd.partialSig = si.sign.partialSig
      if (si.sign.tapKeySig) upd.tapKeySig = si.sign.tapKeySig
      if (si.sign.tapInternalKey) upd.tapInternalKey = si.sign.tapInternalKey
      if (Object.keys(upd).length) psbt.updateInput(k, upd)
    })
    psbt.addInput({ hash: fund.txid, index: fund.vout, witnessUtxo: { script: buyerSpk, value: fund.value } }) // index n
    sellerOuts.forEach((so) => psbt.addOutput(so)) // outputs 0..n-1 (each seller's payment at its index)
    const [bk, ik] = runeId.split(':').map(Number)
    const recvOut = n + 1
    const stone = new lib.Runestone([new lib.Edict(new lib.RuneId(bk, ik), totalAmount, recvOut)], lib.none(), lib.none(), lib.none())
    psbt.addOutput({ script: stone.encipher(), value: 0 }) // output n  = runestone
    psbt.addOutput({ script: buyerSpk, value: DUST }) // output n+1 = buyer rune-receive
    let change = totalInVal + fund.value - totalPrice - DUST - fee
    let realFee = fee
    if (change >= DUST) psbt.addOutput({ script: buyerSpk, value: change }) // output n+2
    else {
      change = 0
      realFee = totalInVal + fund.value - totalPrice - DUST
    }
    if (realFee < 300) return { error: 'Funding UTXO too small for the sweep after fees.' }

    // anti-burn guard on the would-be outputs (summed input runes)
    const guardStone: Stone = { mint: null, pointer: null, edicts: [{ id: runeId, amount: totalAmount, output: recvOut }], cenotaph: false }
    const outScripts: Uint8Array[] = psbt.txOutputs.map((o: any) => o.script)
    const g = allocate(outScripts, guardStone, new Map([[runeId, totalAmount]]))
    if (g.burned.size) return { error: 'Guard: a rune would be burned. Refusing the sweep.' }
    if ((g.out.get(recvOut)?.get(runeId) ?? 0n) !== totalAmount) return { error: 'Guard: not all runes would reach you. Refusing.' }
    for (let k = 0; k < n; k++) if (g.out.get(k)?.get(runeId)) return { error: 'Guard: a seller would get a rune back. Refusing.' }

    return {
      psbtB64: psbt.toBase64(),
      buyerInputIndex: n,
      recvOut,
      runeId,
      runeName: NAMES[runeId] ?? runeId,
      amount: totalAmount,
      offerCount: n,
      totalPrice,
      fee: realFee,
      change,
      taproot: isP2TR,
      sellers,
    }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

/** Finalize the wallet-signed BATCH tx, re-run the anti-burn guard on the FINAL tx (re-trace
    EVERY seller, sum, verify the full sum lands on the buyer recv with nothing burned), then
    broadcast. The node independently re-validates all seller SINGLE|ACP sigs at accept. */
export async function finalizeAndBroadcastBatch(
  signed: string,
  expect: { runeId: string; amount: bigint; recvOut: number; sellers: { txid: string; vout: number }[] },
): Promise<{ txid: string } | { error: string }> {
  try {
    const lib = await getLib()
    const hex = toFinalTxHex(signed, lib)
    const tx = lib.b.Transaction.fromHex(hex)
    const trace = await makeTracer(lib)
    // Trace EVERY input of the FINAL tx (sellers + funding) so the guard sees the TRUE input
    // runes — confirm each expected seller input is consumed, and no UNEXPECTED rune slipped in.
    const want = new Set(expect.sellers.map((s) => `${s.txid}:${s.vout}`))
    const seen = new Set<string>()
    const inSum = new Map<string, bigint>()
    for (const vin of tx.ins) {
      const op = `${Buffer.from(vin.hash).reverse().toString('hex')}:${vin.index}`
      if (want.has(op)) seen.add(op)
      const c = await trace(Buffer.from(vin.hash).reverse().toString('hex'), vin.index)
      if (c === null) return { error: 'final guard: cannot trace a tx input — NOT broadcasting' }
      for (const [id, a] of c) inSum.set(id, (inSum.get(id) ?? 0n) + a)
    }
    if (seen.size !== want.size) return { error: 'final guard: a selected seller input is missing from the signed tx — NOT broadcasting' }
    for (const [id, a] of inSum) if (id !== expect.runeId && a > 0n) return { error: 'final guard: an unexpected rune is in the inputs — NOT broadcasting' }
    const sum = inSum.get(expect.runeId) ?? 0n
    if (sum !== expect.amount) return { error: 'final guard: traced sum changed — NOT broadcasting' }
    const stone = decodeStone(hex, lib)
    const outScripts = tx.outs.map((o: any) => o.script)
    const g = allocate(outScripts, stone, inSum)
    if (g.burned.size) return { error: 'final guard: rune would burn — NOT broadcasting' }
    if ((g.out.get(expect.recvOut)?.get(expect.runeId) ?? 0n) !== sum) return { error: 'final guard: full rune would not reach you — NOT broadcasting' }
    for (const s of expect.sellers) if (!(await isUnspent(s.txid, s.vout))) return { error: 'A seller rune UTXO was already spent (front-run) — NOT broadcasting.' }
    const res = await fetch(`${API}/tx`, { method: 'POST', body: hex })
    const body = await res.text()
    if (!res.ok) return { error: `broadcast rejected: ${body}` }
    return { txid: body.trim() }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

// ── SELLER side: create a SINGLE|ACP offer (the wallet signs the rune UTXO) ──────────
// SIGHASH_SINGLE (0x03) | SIGHASH_ANYONECANPAY (0x80). The seller's signature commits ONLY
// to input0 (their rune UTXO outpoint+amount+script) + output0 (their payment) — a buyer
// freely appends their funding input + the runestone edict + recv/change without
// invalidating it. SIGNING NEVER BROADCASTS: the rune is not spent until a buyer completes
// AND broadcasts WITH the edict (buildTake's anti-burn guard guarantees conservation), so
// creating an offer cannot burn the rune. Worst case is a malformed (un-takeable) offer.
const SINGLE_ACP = 0x83

export type SellerRuneUtxo = { txid: string; vout: number; value: number; runeId: string; runeName: string; amount: bigint }

/** Scan the connected address for single-rune UTXOs the seller could offer (bounded). */
export async function listRuneUtxos(address: string): Promise<SellerRuneUtxo[] | { error: string }> {
  try {
    if (isTestnetAddr(address)) return { error: MAINNET_ONLY }
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const utxos: any[] = await fetchJson(`${API}/address/${encodeURIComponent(address)}/utxo`)
    const out: SellerRuneUtxo[] = []
    let scanned = 0
    for (const u of utxos) {
      if (scanned >= 60) break
      scanned++
      const c = await trace(u.txid, u.vout)
      if (c === null || c.size !== 1) continue // only single-rune UTXOs (v1)
      const [id, amount] = [...c][0]
      out.push({ txid: u.txid, vout: u.vout, value: u.value, runeId: id, runeName: NAMES[id] ?? id, amount })
    }
    return out
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

export type OfferDraft = {
  psbtB64: string
  sellerInputIndex: number
  runeId: string
  runeName: string
  amount: bigint
  price: number
  runeUtxo: string
  sellerAddr: string
  taproot: boolean
}

/** Build the seller's partial SINGLE|ACP offer PSBT (input0 = rune UTXO, output0 = payment).
    Never signs or broadcasts. The caller has the wallet sign input0 with sighash 0x83. */
export async function buildOffer(utxo: SellerRuneUtxo, price: number, sellerAddr: string): Promise<OfferDraft | { error: string }> {
  try {
    if (isTestnetAddr(sellerAddr)) return { error: MAINNET_ONLY }
    if (!Number.isInteger(price) || price < DUST) return { error: `Price must be a whole number of sats ≥ ${DUST}.` }
    const lib = await getLib()
    const trace = await makeTracer(lib)
    // re-trace to confirm the UTXO really holds exactly this single rune (never trust the list)
    const content = await trace(utxo.txid, utxo.vout)
    if (content === null) return { error: 'Could not fully trace your rune UTXO — refusing to offer it.' }
    if (content.size !== 1) return { error: `That UTXO holds ${content.size} runes; only single-rune offers are supported.` }
    const [id, amount] = [...content][0]
    if (id !== utxo.runeId || amount !== utxo.amount) return { error: 'Rune content changed since it was listed — refresh and retry.' }
    const sellerSpk = lib.b.address.toOutputScript(sellerAddr, BELLS)
    const isP2WPKH = sellerSpk.length === 22 && sellerSpk[0] === 0x00 && sellerSpk[1] === 0x14
    const isP2TR = sellerSpk.length === 34 && sellerSpk[0] === 0x51 && sellerSpk[1] === 0x20
    if (!isP2WPKH && !isP2TR) return { error: 'Your address type is unsupported (need a bel1q… or bel1p… address).' }
    const psbt = new lib.b.Psbt({ network: BELLS })
    psbt.addInput({ hash: utxo.txid, index: utxo.vout, witnessUtxo: { script: sellerSpk, value: utxo.value }, sighashType: SINGLE_ACP })
    psbt.addOutput({ script: sellerSpk, value: price }) // output 0 — committed by SINGLE|ACP
    return {
      psbtB64: psbt.toBase64(),
      sellerInputIndex: 0,
      runeId: id,
      runeName: NAMES[id] ?? id,
      amount,
      price,
      runeUtxo: `${utxo.txid}:${utxo.vout}`,
      sellerAddr,
      taproot: isP2TR,
    }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

/** Extract the sighash-type byte from a serialized P2WPKH witness ([count][len sig][sig…]).
    Returns null if it can't be parsed (e.g. taproot). */
function witnessSighashByte(w: any): number | null {
  if (!w?.length || w.length < 3) return null
  const count = w[0]
  if (count < 1) return null
  const len = w[1] // P2WPKH sig length < 0xfd
  if (len < 1 || 2 + len > w.length) return null
  return w[1 + len]
}

/** Validate the wallet-signed offer (still a bare input0→output0, payment intact, signed
    with SINGLE|ACP 0x83), then POST it to the relay. Refuses to publish a malformed offer —
    a non-0x83 sig would silently break when a buyer appends outputs. */
export async function validateAndPostOffer(signed: string, draft: OfferDraft, relay: string): Promise<{ id: string; cancelToken?: string } | { error: string }> {
  try {
    const lib = await getLib()
    const s = signed.trim()
    const psbt = /^cHNidP/.test(s) ? lib.b.Psbt.fromBase64(s, { network: BELLS }) : lib.b.Psbt.fromHex(s, { network: BELLS })
    // shape: exactly input0 -> output0 (a buyer appends the rest); the wallet must not alter it
    if (psbt.data.inputs.length !== 1 || psbt.txOutputs.length !== 1) return { error: 'Wallet altered the offer shape — refusing to publish.' }
    const out0 = psbt.txOutputs[0]
    const sellerSpk = lib.b.address.toOutputScript(draft.sellerAddr, BELLS)
    if (out0.value !== draft.price || Buffer.compare(Buffer.from(out0.script), Buffer.from(sellerSpk)) !== 0)
      return { error: 'Wallet changed the payment output — refusing to publish.' }
    // the SINGLE|ACP signature must be present AND sighash-typed 0x83
    const inp: any = psbt.data.inputs[0]
    let sh: number | null = null
    if (inp.partialSig?.length) {
      const sig = inp.partialSig[0].signature
      sh = sig[sig.length - 1]
    } else if (inp.tapKeySig) {
      sh = inp.tapKeySig.length === 65 ? inp.tapKeySig[64] : (inp.sighashType ?? 0x00)
    } else if (inp.finalScriptWitness) {
      sh = witnessSighashByte(inp.finalScriptWitness)
    }
    if (sh === null) return { error: 'Wallet returned no signature on the rune input — nothing to publish.' }
    if (sh !== SINGLE_ACP)
      return { error: `Wallet signed sighash 0x${sh.toString(16)} instead of SINGLE|ANYONECANPAY (0x83). Publishing this would let a buyer break the swap — refused.` }
    const res = await fetch(`${relay}/offers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runeId: draft.runeId, runeUtxo: draft.runeUtxo, price: draft.price, sellerAddr: draft.sellerAddr, psbt: psbt.toBase64(), amountHint: draft.amount.toString() }),
    })
    const b: any = await res.json().catch(() => ({}))
    if (!res.ok || !b.id) return { error: `Relay rejected the offer: ${res.status} ${JSON.stringify(b)}` }
    return { id: b.id, cancelToken: b.cancelToken }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

/** An address's EXACT rune balances via bounded lineage replay. Unlike the Portfolio's
    simple per-tx decode (runes.ts `fetchRuneBalances`), this resolves runes received via a
    transfer/swap EDICT — those carry no mint in their creating tx, so the simple decoder
    (which only seeds from mints) attributes 0 to them. Bounded: big wallets hit the tracer's
    fetch cap → partial → `capped` (UI shows "≥"). Reuses the same makeTracer as the swap. */
export async function traceRuneBalances(address: string): Promise<RuneBalancesResult> {
  try {
    if (isTestnetAddr(address)) return { rows: [], capped: false }
    // Prefer the ord indexer when configured + reachable: exact, complete, no cap.
    // null ⇒ disabled/unreachable → fall through to the client-side lineage replay.
    const fromOrd = await ordAddressBalances(address)
    if (fromOrd) return { rows: fromOrd, capped: false }
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const utxos: any[] = await fetchJson(`${API}/address/${encodeURIComponent(address)}/utxo`)
    if (!Array.isArray(utxos)) return { error: true }
    if (utxos.length === 0) return { rows: [], capped: false }
    const MAXU = 150
    let capped = utxos.length > MAXU || utxos.length >= 1000
    const held = new Map<string, bigint>()
    for (const u of utxos.slice(0, MAXU)) {
      const c = await trace(u.txid, u.vout)
      if (c === null) {
        capped = true // unresolved (cap hit / too deep) → treat the total as a lower bound
        continue
      }
      for (const [id, a] of c) held.set(id, (held.get(id) ?? 0n) + a)
    }
    const rows: RuneBalance[] = []
    for (const [id, amount] of held) {
      if (amount <= 0n) continue
      const meta = await resolveRune(id)
      rows.push({
        id,
        name: meta.display,
        symbol: cleanSymbol(meta.symbol),
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
