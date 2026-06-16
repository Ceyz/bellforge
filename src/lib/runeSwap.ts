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
import { ELECTRS } from '../config'
import type { Offer } from './offers'
import { resolveRune, formatRuneAmount, cleanSymbol, type RuneBalancesResult, type RuneBalance } from './runes'

const API = ELECTRS.mainnet
const DUST = 546
const PERMINT: Record<string, bigint> = { '1:0': 1n }
// Bellscoin mainnet params for bitcoinjs-lib (bech32 'bel', wif 0x99).
const BELLS = {
  messagePrefix: '\x18Bells Signed Message:\n',
  bech32: 'bel',
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 25,
  scriptHash: 30,
  wif: 0x99,
}

type Lib = { b: any; Runestone: any; Edict: any; RuneId: any; none: any }
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
    return { b, Runestone: r.Runestone ?? rmod.Runestone, Edict: r.Edict ?? rmod.Edict, RuneId: r.RuneId ?? rmod.RuneId, none: r.none ?? rmod.none }
  })()
  return _lib
}

const ov = (x: any): any => (x == null ? null : typeof x.value === 'function' ? x.value() : '_value' in x ? x._value : x)

type Stone = { mint: string | null; pointer: number | null; edicts: { id: string; amount: bigint; output: number }[] }
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
  const edicts: Stone['edicts'] = []
  for (const e of s.edicts || []) {
    const ev = e._value || e
    const id = ov(ev.id) || ev.id
    if (id && id.block != null) edicts.push({ id: `${id.block}:${id.idx}`, amount: BigInt(ev.amount), output: Number(ev.output) })
  }
  const ptr = ov(s.pointer)
  return { mint: mint && mint.block != null ? `${mint.block}:${mint.idx}` : null, pointer: typeof ptr === 'number' ? ptr : null, edicts }
}

function allocate(outScripts: Uint8Array[], stone: Stone | null, inputRunes: Map<string, bigint>) {
  const n = outScripts.length
  const isOR = (k: number) => outScripts[k]?.[0] === 0x6a
  const elig: number[] = []
  for (let k = 0; k < n; k++) if (!isOR(k)) elig.push(k)
  const un = new Map(inputRunes)
  const out = new Map<number, Map<string, bigint>>()
  const burned = new Map<string, bigint>()
  const add = (m: Map<string, bigint>, id: string, a: bigint) => m.set(id, (m.get(id) ?? 0n) + a)
  const slot = (k: number) => out.get(k) ?? out.set(k, new Map()).get(k)!
  if (stone) {
    if (stone.mint) add(un, stone.mint, PERMINT[stone.mint] ?? 0n)
    for (const ed of stone.edicts) {
      const have = un.get(ed.id) ?? 0n
      if (ed.output < 0 || ed.output >= n || isOR(ed.output)) continue
      const g = ed.amount === 0n ? have : ed.amount < have ? ed.amount : have
      add(slot(ed.output), ed.id, g)
      un.set(ed.id, have - g)
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
    const txj = await fetch(`${API}/tx/${txid}`).then((r) => r.json())
    if (txj.vin?.[0]?.is_coinbase) {
      memo.set(key, new Map())
      return new Map()
    }
    const hex = await fetch(`${API}/tx/${txid}/hex`).then((r) => r.text())
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
    const outScripts = lib.b.Transaction.fromHex(hex).outs.map((o: any) => o.script)
    const res = allocate(outScripts, stone, inR).out.get(vout) ?? new Map()
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

/** Build the buyer's completion of an offer. Never throws — returns { error }.
    Does NOT sign or broadcast. The caller has the wallet sign buyerInputIndex
    (plain BELLS, SIGHASH_ALL), then calls finalizeAndBroadcast. */
export async function buildTake(offer: Offer, buyerAddress: string): Promise<TakePlan | { error: string }> {
  try {
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const psbt = lib.b.Psbt.fromBase64(offer.psbt, { network: BELLS })
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
    const utxos: any[] = await fetch(`${API}/address/${encodeURIComponent(buyerAddress)}/utxo`).then((r) => r.json())
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
    const guardStone: Stone = { mint: null, pointer: null, edicts: [{ id, amount, output: 2 }] }
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
    // independent final guard on the assembled tx
    const trace = await makeTracer(lib)
    const content = await trace(expect.runeTxid, expect.runeVout)
    if (content === null) return { error: 'final guard: cannot trace seller content' }
    const stone = decodeStone(hex, lib)
    const outScripts = tx.outs.map((o: any) => o.script)
    const g = allocate(outScripts, stone, content)
    if (g.burned.size) return { error: 'final guard: rune would burn — NOT broadcasting' }
    if ((g.out.get(2)?.get(expect.runeId) ?? 0n) !== expect.amount) return { error: 'final guard: buyer would not receive the full rune — NOT broadcasting' }
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
      if (p.txInputs.length !== 1 || p.txOutputs.length !== 1) return { error: 'A selected offer is not a bare SINGLE|ACP listing.' }
      const txid = Buffer.from(p.txInputs[0].hash).reverse().toString('hex')
      const vout = p.txInputs[0].index
      const content = await trace(txid, vout)
      if (content === null) return { error: 'Could not fully trace a seller rune UTXO — refusing the sweep.' }
      const keys = [...content.keys()]
      if (keys.length !== 1) return { error: 'A seller UTXO holds multiple runes — not sweepable.' }
      const id = keys[0]
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
    const utxos: any[] = await fetch(`${API}/address/${encodeURIComponent(buyerAddress)}/utxo`).then((r) => r.json())
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
    const guardStone: Stone = { mint: null, pointer: null, edicts: [{ id: runeId, amount: totalAmount, output: recvOut }] }
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
    let sum = 0n
    for (const s of expect.sellers) {
      const c = await trace(s.txid, s.vout)
      if (c === null) return { error: 'final guard: cannot trace a seller' }
      sum += c.get(expect.runeId) ?? 0n
    }
    if (sum !== expect.amount) return { error: 'final guard: traced sum changed — NOT broadcasting' }
    const stone = decodeStone(hex, lib)
    const outScripts = tx.outs.map((o: any) => o.script)
    const g = allocate(outScripts, stone, new Map([[expect.runeId, sum]]))
    if (g.burned.size) return { error: 'final guard: rune would burn — NOT broadcasting' }
    if ((g.out.get(expect.recvOut)?.get(expect.runeId) ?? 0n) !== sum) return { error: 'final guard: full rune would not reach you — NOT broadcasting' }
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
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const utxos: any[] = await fetch(`${API}/address/${encodeURIComponent(address)}/utxo`).then((r) => r.json())
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
export async function validateAndPostOffer(signed: string, draft: OfferDraft, relay: string): Promise<{ id: string } | { error: string }> {
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
    return { id: b.id }
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
    const lib = await getLib()
    const trace = await makeTracer(lib)
    const utxos: any[] = await fetch(`${API}/address/${encodeURIComponent(address)}/utxo`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('utxo fetch'))))
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
