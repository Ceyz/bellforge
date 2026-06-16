import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { PageHeader } from '../components/app/PageHeader'
import { RouteSelector } from '../components/app/RouteSelector'
import { SlidingToggle } from '../components/juice/SlidingToggle'
import { ForgeButton } from '../components/juice/ForgeButton'
import { fetchOffers, cancelOffer, type Offer } from '../lib/offers'
import { buildTake, finalizeAndBroadcast, listRuneUtxos, buildOffer, validateAndPostOffer, type TakePlan, type SellerRuneUtxo, type OfferDraft } from '../lib/runeSwap'
import { useWallet } from '../wallet/WalletProvider'
import { EXPLORER, RELAY } from '../config'
import { TokenPicker } from '../components/app/TokenPicker'
import { RuneTradeChart } from '../components/app/RuneTradeChart'
import { getToken, type TokenInfo } from '../lib/tokens'

/* Illustrative book — clearly labelled a preview. No real market exists pre-mainnet. */
const ASKS = [
  { p: 0.00485, s: 1200 },
  { p: 0.00472, s: 840 },
  { p: 0.00461, s: 2100 },
  { p: 0.00455, s: 560 },
  { p: 0.0045, s: 1500 },
]
const BIDS = [
  { p: 0.00444, s: 980 },
  { p: 0.00438, s: 1700 },
  { p: 0.00431, s: 620 },
  { p: 0.0042, s: 2400 },
  { p: 0.00412, s: 1100 },
]
const MAX = Math.max(...ASKS.map((o) => o.s), ...BIDS.map((o) => o.s))

const inputCls = 'w-full bg-transparent text-lg text-text-hi outline-none placeholder:text-text-lo'
const well = 'input-forge rounded-btn border border-ink-600 bg-ink-900 p-4'

function OrderRow({ p, s, side, i }: { p: number; s: number; side: 'ask' | 'bid'; i: number }) {
  const reduce = useReducedMotion()
  const color = side === 'ask' ? 'text-red-400' : 'text-emerald-400'
  const grad =
    side === 'ask'
      ? 'linear-gradient(270deg,rgba(239,68,68,0.28),rgba(239,68,68,0.03))'
      : 'linear-gradient(270deg,rgba(16,185,129,0.28),rgba(16,185,129,0.03))'
  return (
    <div className="relative grid grid-cols-3 px-3 py-1 font-mono text-xs">
      <motion.div
        aria-hidden
        className="absolute inset-y-0 right-0 rounded-sm"
        style={{ width: `${(s / MAX) * 100}%`, transformOrigin: 'right', background: grad }}
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
      />
      <span className={`relative ${color}`}>{p.toFixed(5)}</span>
      <span className="relative text-right text-text-mid">{s.toLocaleString()}</span>
      <span className="relative text-right text-text-lo">{(p * s).toFixed(2)}</span>
    </div>
  )
}

function Chart({ sym }: { sym: string }) {
  const reduce = useReducedMotion()
  // Illustrative line — a calm shape, explicitly not real price data.
  const pts = [8, 14, 11, 18, 16, 22, 19, 26, 24, 30, 28, 33]
  const w = 100
  const h = 40
  const step = w / (pts.length - 1)
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const y = (v: number) => h - ((v - min) / (max - min)) * (h - 6) - 3
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${y(v)}`).join(' ')
  const area = `${line} L ${w} ${h} L 0 ${h} Z`
  const topPct = (y(pts[pts.length - 1]) / h) * 100
  return (
    <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-text-hi">{sym} / $BELLS</span>
        <span className="font-micro text-[10px] tracking-wide text-text-lo">ILLUSTRATIVE · NO LIVE MARKET</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full">
          <defs>
            <linearGradient id="ch" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-forge-500)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--color-forge-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#ch)" />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--color-forge-400)"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
            initial={reduce ? false : { pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <span aria-hidden className="ember-dot absolute h-2 w-2 -translate-y-1/2 rounded-full bg-bell-300" style={{ top: `${topPct}%`, right: 2 }} />
      </div>
    </div>
  )
}

export function Trade() {
  const reduce = useReducedMotion()
  const [mode, setMode] = useState<'market' | 'limit'>('market')
  const [amt, setAmt] = useState('')
  const [recv, setRecv] = useState<TokenInfo>(() => getToken('bound')!)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dir, setDir] = useState<'in' | 'out'>('in') // 'in' = pay $BELLS → receive token; 'out' = the reverse
  const recvIsRune = recv.protocol === 'rune'

  // The selectable token pill (opens the picker) + the static $BELLS pill — placed on
  // whichever side `dir` puts them so the flip arrow actually swaps pay ↔ receive.
  const tokenPill = (
    <button
      type="button"
      onClick={() => setPickerOpen(true)}
      title="Pick a token"
      className="flex items-center gap-1.5 rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600 transition hover:ring-forge-400"
    >
      <span>{recv.sym}</span>
      <span className={`rounded-pill px-1.5 py-px font-micro text-[8px] uppercase tracking-wide ${recvIsRune ? 'bg-violet-500/15 text-violet-300' : 'bg-forge-500/15 text-forge-300'}`}>
        {recvIsRune ? 'Rune' : 'OP_CAT'}
      </span>
      <span className="text-text-lo">▾</span>
    </button>
  )
  const bellsPill = <span className="rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600">$BELLS</span>
  return (
    <>
      <PageHeader
        title="Trade"
        subtitle="Swap $BELLS, $BOUND and any OP_CAT token via signed PSBT atomic orders — no custody, no AMM trust."
        status="soon"
      />

      {recvIsRune ? (
        <RuneTradeView rune={recv} pill={tokenPill} />
      ) : (
        <>
          <div className="mb-5 rounded-card border border-forge-500/25 bg-forge-500/[0.06] px-4 py-3 text-center text-xs text-text-mid">
            Interface preview — the order book opens at mainnet. The numbers below are{' '}
            <span className="text-text-hi">illustrative</span>, not live orders.
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <Chart sym={recv.sym} />

              <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
                <h3 className="font-display text-text-hi">Order book</h3>
                <div className="mt-3 grid grid-cols-3 px-3 pb-1 font-micro text-[10px] uppercase tracking-wide text-text-lo">
                  <span>Price ($BELLS)</span>
                  <span className="text-right">Size ({recv.sym})</span>
                  <span className="text-right">Total</span>
                </div>
                <div className="space-y-px">
                  {ASKS.map((o, i) => (
                    <OrderRow key={`a${o.p}`} {...o} side="ask" i={i} />
                  ))}
                </div>
                <div className="my-1.5 flex items-center justify-between border-y border-ink-600 px-3 py-1.5 text-xs">
                  <span className="font-mono text-text-hi">0.00450</span>
                  <span className="font-micro text-[10px] tracking-wide text-text-lo">SPREAD 1.3%</span>
                </div>
                <div className="space-y-px">
                  {BIDS.map((o, i) => (
                    <OrderRow key={`b${o.p}`} {...o} side="bid" i={i} />
                  ))}
                </div>
              </div>
            </div>

            <div className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-5">
              <SlidingToggle
                options={[
                  { id: 'market', label: 'Market' },
                  { id: 'limit', label: 'Limit' },
                ]}
                value={mode}
                onChange={setMode}
                layoutId="toggle-trade-mode"
                className="w-full"
              />

              <div className={well}>
                <div className="mb-1 text-xs text-text-lo">You pay</div>
                <div className="flex items-center justify-between gap-3">
                  <input value={amt} onChange={(e) => setAmt(e.target.value)} className={inputCls} placeholder="0.0" inputMode="decimal" />
                  {dir === 'in' ? bellsPill : tokenPill}
                </div>
              </div>

              {mode === 'limit' && (
                <div className={well}>
                  <div className="mb-1 text-xs text-text-lo">Limit price ($BELLS)</div>
                  <input className={`${inputCls} text-base`} placeholder="0.00450" inputMode="decimal" />
                </div>
              )}

              <div className="flex justify-center">
                <motion.button
                  type="button"
                  onClick={() => setDir((d) => (d === 'in' ? 'out' : 'in'))}
                  aria-label="Flip direction"
                  title="Flip pay / receive"
                  animate={reduce ? undefined : { rotate: dir === 'in' ? 0 : 180 }}
                  whileTap={reduce ? undefined : { scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-forge-400 ring-1 ring-ink-600 transition hover:text-forge-300 hover:ring-forge-400"
                >
                  ↓
                </motion.button>
              </div>

              <div className={well}>
                <div className="mb-1 text-xs text-text-lo">You receive</div>
                <div className="flex items-center justify-between gap-3">
                  <input className={inputCls} placeholder="0.0" inputMode="decimal" />
                  {dir === 'in' ? tokenPill : bellsPill}
                </div>
              </div>

              <RouteSelector amountIn={Number(amt) || 0} />

              <ForgeButton disabled idleLabel={`${mode === 'market' ? 'Swap' : 'Place order'} — opens at mainnet`} />
              <p className="text-center text-xs text-text-lo">
                Orders are peer-to-peer signed PSBTs — no custody, no AMM. The book needs no new opcodes, so it
                ships the day {recv.sym} is live.
              </p>
            </div>
          </div>
        </>
      )}

      {pickerOpen && (
        <TokenPicker
          exclude={['bells']}
          onClose={() => setPickerOpen(false)}
          onSelect={(t) => {
            setRecv(t)
            setPickerOpen(false)
          }}
        />
      )}
    </>
  )
}

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)
/** A readable message from a thrown wallet error. Nintondo rejects with a {code,message}
    OBJECT (String(e) → "[object Object]"), and a user-cancel shows up as code 4001 /
    "reject"/"cancel"/"denied". */
function walletErr(e: unknown): string {
  const o = e as { code?: number; message?: string }
  const msg = o?.message ?? (typeof e === 'string' ? e : '')
  if (o?.code === 4001 || /reject|cancel|denied|declin/i.test(msg)) return 'Signature cancelled.'
  return msg || 'Wallet error.'
}
function ago(sec: number) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec)
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

type TakeState = { offer: Offer; plan?: TakePlan; phase: 'building' | 'confirm' | 'signing' | 'done' | 'error'; msg?: string; txid?: string }
type SellState = {
  phase: 'scanning' | 'pick' | 'building' | 'confirm' | 'signing' | 'done' | 'error'
  utxos?: SellerRuneUtxo[]
  draft?: OfferDraft
  price?: string
  msg?: string
}

type SweepRun = { total: number; done: number; phase: 'running' | 'done'; results: { id: string; price: number; txid?: string; error?: string }[] }
const pricePerUnit = (o: Offer) => o.price / Math.max(1, Number(o.amount_hint || '0'))

/** The rune trading surface for ONE rune: chart + live sell orders (cheapest-first) +
    a Magic-Eden-style budget SWEEP (fill cheapest offers up to a budget) + create-offer.
    Shown only when a Rune is the selected token; OP_CAT keeps the illustrative book. */
function RuneTradeView({ rune, pill }: { rune: TokenInfo; pill: ReactNode }) {
  const { address } = useWallet()
  const [state, setState] = useState<'loading' | 'unconfigured' | 'error' | 'ok'>('loading')
  const [offers, setOffers] = useState<Offer[]>([])
  const [take, setTake] = useState<TakeState | null>(null)
  const [sell, setSell] = useState<SellState | null>(null)
  const [budget, setBudget] = useState('')
  const [sweepRun, setSweepRun] = useState<SweepRun | null>(null)
  const sweepCancelled = useRef(false)
  const [cancelling, setCancelling] = useState<string | null>(null)

  async function onCancelOffer(id: string) {
    setCancelling(id)
    const ok = await cancelOffer(id)
    setCancelling(null)
    if (ok) setOffers((os) => os.filter((o) => o.id !== id))
  }

  useEffect(() => {
    let alive = true
    fetchOffers().then((r) => {
      if (!alive) return
      if ('unconfigured' in r) setState('unconfigured')
      else if ('error' in r) setState('error')
      else {
        setOffers(r.offers)
        setState('ok')
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // this rune's live offers, cheapest (per-unit) first
  const runeOffers = useMemo(
    () => offers.filter((o) => o.rune_id === rune.runeId).sort((a, b) => pricePerUnit(a) - pricePerUnit(b)),
    [offers, rune.runeId],
  )

  // SWEEP: greedily fill the cheapest offers whose cumulative cost fits the budget
  const sweep = useMemo(() => {
    const b = Math.floor(Number(budget) || 0)
    const picked: Offer[] = []
    let spent = 0
    let units = 0n
    for (const o of runeOffers) {
      if (spent + o.price > b) continue
      picked.push(o)
      spent += o.price
      units += BigInt(o.amount_hint || '0')
    }
    const pickedIds = new Set(picked.map((o) => o.id))
    return { picked, pickedIds, spent, units }
  }, [runeOffers, budget])

  /** One full take: build → wallet-sign → finalize+broadcast → mark taken. NEVER throws —
      a wallet rejection (Nintondo rejects with a {code,message} object) is caught and
      returned as { error } so the modal can always recover (no stuck "signing…" popup). */
  async function takeOne(offer: Offer): Promise<{ txid: string } | { error: string }> {
    if (!address) return { error: 'Connect your Bells wallet first.' }
    try {
      const r = await buildTake(offer, address)
      if ('error' in r) return { error: r.error }
      const p = r
      const nin = (window as { nintondo?: { signPsbt?: (psbt: string, opts: unknown) => Promise<unknown> } }).nintondo
      if (!nin?.signPsbt) return { error: 'Wallet signPsbt unavailable.' }
      // P2WPKH funding → SIGHASH_ALL (1); taproot keyspend → SIGHASH_DEFAULT (omit whitelist).
      const toSign = p.taproot ? { index: p.buyerInputIndex, address } : { index: p.buyerInputIndex, address, sighashTypes: [1] }
      const signed = await nin.signPsbt(p.psbtB64, { autoFinalized: false, toSignInputs: [toSign] }) // base64 in
      const s = signed as Record<string, string>
      const signedStr = typeof signed === 'string' ? signed : (s?.psbtBase64 ?? s?.psbt ?? s?.psbtHex ?? s?.hex ?? s?.base64 ?? '')
      if (!signedStr) return { error: 'Wallet returned no signed PSBT.' }
      const res = await finalizeAndBroadcast(signedStr, { runeId: p.runeId, amount: p.amount, runeTxid: p.runeTxid, runeVout: p.runeVout })
      if ('error' in res) return res
      if (RELAY) fetch(`${RELAY}/offers/${offer.id}/taken`, { method: 'POST' }).catch(() => {})
      return { txid: res.txid }
    } catch (e) {
      return { error: walletErr(e) }
    }
  }

  async function startTake(offer: Offer) {
    if (!address) {
      setTake({ offer, phase: 'error', msg: 'Connect your Bells wallet first (top right).' })
      return
    }
    setTake({ offer, phase: 'building' })
    const r = await buildTake(offer, address)
    if ('error' in r) setTake({ offer, phase: 'error', msg: r.error })
    else setTake({ offer, plan: r, phase: 'confirm' })
  }

  async function confirmTake() {
    if (!take?.plan || !address) return
    setTake({ ...take, phase: 'signing' })
    const res = await takeOne(take.offer)
    if ('error' in res) {
      setTake({ ...take, phase: 'error', msg: res.error })
      return
    }
    setOffers((os) => os.filter((o) => o.id !== take.offer.id))
    setTake({ ...take, phase: 'done', txid: res.txid })
  }

  /** Sweep: take the budget-selected offers cheapest-first, SEQUENTIALLY — each is its own
      tx + wallet signature, reusing the audited single-offer buildTake. Batching all offers
      into ONE tx is possible (Magic-Eden msigner style) but needs a different index-mirrored
      builder: seller_k input @ index k ↔ payment @ index k, then a single runestone edicting
      the SUMMED amount + a combined anti-burn guard + re-validating every seller 0x83 sig.
      That's a separate audited path; sequential is the safe v1. Stops on the first failure
      (rejected signature / broadcast) → a clean partial fill. */
  async function startSweep() {
    if (!address) {
      setSweepRun({ total: 0, done: 0, phase: 'done', results: [{ id: '-', price: 0, error: 'Connect your Bells wallet first.' }] })
      return
    }
    const picked = sweep.picked
    if (!picked.length) return
    sweepCancelled.current = false
    const results: SweepRun['results'] = []
    setSweepRun({ total: picked.length, done: 0, phase: 'running', results })
    for (const o of picked) {
      if (sweepCancelled.current) return // user closed the modal mid-sweep → stop, leave it dismissed
      const res = await takeOne(o) // never throws
      if (sweepCancelled.current) return
      const row = 'txid' in res ? { id: o.id, price: o.price, txid: res.txid } : { id: o.id, price: o.price, error: res.error }
      results.push(row)
      setSweepRun({ total: picked.length, done: results.length, phase: 'running', results: [...results] })
      if ('txid' in res) setOffers((os) => os.filter((x) => x.id !== o.id))
      else break // partial fill on the first error (user rejected / broadcast failed)
    }
    if (!sweepCancelled.current) setSweepRun((r) => (r ? { ...r, phase: 'done' } : r))
  }

  // ── SELLER: create a SINGLE|ACP offer (signing never broadcasts — no burn risk) ──
  async function openSell() {
    if (!address) {
      setSell({ phase: 'error', msg: 'Connect your Bells wallet first (top right).' })
      return
    }
    setSell({ phase: 'scanning' })
    const r = await listRuneUtxos(address)
    if ('error' in r) setSell({ phase: 'error', msg: r.error })
    else if (r.length === 0) setSell({ phase: 'error', msg: 'No single-rune UTXOs on this address. Connect a wallet account that holds runes (bel1q…).' })
    else setSell({ phase: 'pick', utxos: r, price: '' })
  }

  async function startOffer(utxo: SellerRuneUtxo) {
    const priceNum = Number(sell?.price)
    if (!Number.isInteger(priceNum) || priceNum < 546) {
      setSell((s) => (s ? { ...s, msg: 'Enter a whole price ≥ 546 sats.' } : s))
      return
    }
    setSell((s) => (s ? { ...s, phase: 'building', msg: undefined } : s))
    const r = await buildOffer(utxo, priceNum, address!)
    setSell((s) => ('error' in r ? { phase: 'error', msg: r.error } : { phase: 'confirm', draft: r, utxos: s?.utxos, price: s?.price }))
  }

  async function confirmOffer() {
    if (!sell?.draft) return
    const d = sell.draft
    setSell({ ...sell, phase: 'signing' })
    try {
      const nin = (window as { nintondo?: { signPsbt?: (psbt: string, opts: unknown) => Promise<unknown> } }).nintondo
      if (!nin?.signPsbt) throw new Error('Wallet signPsbt unavailable.')
      // The wallet signs the rune input with SIGHASH_SINGLE|ANYONECANPAY (0x83). This does
      // NOT broadcast — it only produces a partial offer. validateAndPostOffer refuses to
      // publish unless the wallet actually returned a 0x83 signature + an intact payment.
      const toSign = { index: d.sellerInputIndex, address: address!, sighashTypes: [0x83] }
      const signed = await nin.signPsbt(d.psbtB64, { autoFinalized: false, toSignInputs: [toSign] })
      const s = signed as Record<string, string>
      const signedStr = typeof signed === 'string' ? signed : (s?.psbtBase64 ?? s?.psbt ?? s?.psbtHex ?? s?.hex ?? s?.base64 ?? '')
      if (!signedStr) throw new Error('Wallet returned no signed PSBT.')
      const res = await validateAndPostOffer(signedStr, d, RELAY)
      if ('error' in res) {
        setSell({ phase: 'error', msg: res.error })
        return
      }
      // refresh the live board so the new offer shows
      fetchOffers().then((rr) => { if (!('error' in rr) && !('unconfigured' in rr)) setOffers(rr.offers) })
      setSell({ phase: 'done' })
    } catch (e) {
      setSell({ phase: 'error', msg: String((e as Error)?.message || e) })
    }
  }

  const note = (msg: string) => <div className="rounded-btn border border-dashed border-ink-600 p-6 text-center text-sm text-text-mid">{msg}</div>
  const totalUnits = runeOffers.reduce((s, o) => s + BigInt(o.amount_hint || '0'), 0n)
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT — REAL price from settled swaps (not illustrative) + live sell orders */}
        <div className="space-y-6">
          <RuneTradeChart rune={rune} />

          <div className="rounded-card border border-ink-600 bg-ink-800/60 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-display text-text-hi">Sell orders · {rune.sym}</h3>
              <span className="font-micro text-[10px] uppercase tracking-wide text-text-lo">{state === 'ok' ? `${runeOffers.length} live` : state}</span>
            </div>
            <p className="mb-3 text-xs text-text-lo">
              Real atomic swaps: each seller signs a SIGHASH_SINGLE|ANYONECANPAY offer; you complete it. Your wallet signs{' '}
              <span className="text-text-mid">only your $BELLS funding input</span> — never a rune UTXO. Cheapest first.
            </p>
            {state === 'unconfigured'
              ? note('Offer relay not configured yet.')
              : state === 'error'
                ? note('Relay unreachable right now.')
                : state === 'loading'
                  ? note('Loading offers…')
                  : runeOffers.length === 0
                    ? note(`No live ${rune.sym} offers yet. Be the first — “Sell ${rune.sym}” →`)
                    : (
                      <div className="overflow-hidden rounded-btn border border-ink-600">
                        <table className="w-full text-sm">
                          <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-text-lo">
                            <tr>
                              <th className="px-4 py-2 font-medium">Price</th>
                              <th className="px-4 py-2 font-medium">Units</th>
                              <th className="px-4 py-2 font-medium">Seller</th>
                              <th className="px-4 py-2 font-medium">Age</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink-600">
                            {runeOffers.map((o) => {
                              const inSweep = sweep.pickedIds.has(o.id)
                              return (
                                <tr key={o.id} className={inSweep ? 'bg-forge-500/[0.07]' : ''}>
                                  <td className="px-4 py-3 font-mono text-text-hi">
                                    {o.price.toLocaleString()} <span className="text-[10px] text-text-lo">sats</span>
                                    {inSweep && <span className="ml-1.5 font-micro text-[8px] uppercase tracking-wide text-forge-300">in sweep</span>}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-text-mid">{o.amount_hint ? `~${o.amount_hint}` : '—'}</td>
                                  <td className="px-4 py-3">
                                    <a href={`${EXPLORER}/address/${o.seller_addr}`} target="_blank" rel="noopener noreferrer" className="font-mono text-text-lo transition hover:text-forge-400">
                                      {short(o.seller_addr)}
                                    </a>
                                  </td>
                                  <td className="px-4 py-3 text-text-lo">{ago(o.created_at)}</td>
                                  <td className="px-4 py-3 text-right">
                                    {address && o.seller_addr === address ? (
                                      <span className="inline-flex items-center gap-2">
                                        <span className="font-micro text-[9px] uppercase tracking-wide text-text-lo">Your offer</span>
                                        <button
                                          type="button"
                                          onClick={() => onCancelOffer(o.id)}
                                          disabled={cancelling === o.id}
                                          title="Delist your offer (nothing was broadcast; the rune never moved)."
                                          className="rounded-btn border border-ink-600 px-3 py-1.5 text-xs font-medium text-text-hi transition hover:border-red-400/60 hover:text-red-300 disabled:opacity-50"
                                        >
                                          {cancelling === o.id ? 'Cancelling…' : 'Cancel'}
                                        </button>
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => startTake(o)}
                                        title={address ? 'Buy this offer — your wallet signs only your $BELLS funding input.' : 'Connect your wallet to take an offer.'}
                                        className="rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:brightness-110"
                                      >
                                        Take
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
          </div>
        </div>

        {/* RIGHT — Magic-Eden-style budget sweep + create-offer */}
        <div className="h-fit space-y-4 rounded-card border border-ink-600 bg-ink-800/60 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-text-hi">Buy {rune.sym}</h3>
            {pill}
          </div>

          <div className={well}>
            <div className="mb-1 flex items-center justify-between text-xs text-text-lo">
              <span>Budget</span>
              <span className="font-mono">{state === 'ok' ? `${runeOffers.length} offers · ~${totalUnits.toString()} ${rune.sym}` : ''}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <input value={budget} onChange={(e) => setBudget(e.target.value)} className={inputCls} placeholder="0" inputMode="numeric" />
              <span className="rounded-pill bg-ink-800 px-3 py-1 font-mono text-sm text-text-hi ring-1 ring-ink-600">sats</span>
            </div>
          </div>

          <div className="rounded-btn border border-ink-600 bg-ink-900 p-3 text-sm">
            <div className="flex justify-between"><span className="text-text-lo">Fills</span><span className="font-mono text-text-hi">{sweep.picked.length} offer{sweep.picked.length === 1 ? '' : 's'}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-text-lo">You receive</span><span className="font-mono text-text-hi">~{sweep.units.toString()} {rune.sym}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-text-lo">You pay</span><span className="font-mono text-text-mid">{sweep.spent.toLocaleString()} sats</span></div>
          </div>

          <button
            type="button"
            onClick={startSweep}
            disabled={!sweep.picked.length}
            className="w-full rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-3 text-sm font-semibold text-ink-950 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sweep.picked.length ? `Sweep ${sweep.picked.length} cheapest` : 'Set a budget to sweep'}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-text-lo">
            Fills the cheapest offers up to your budget. Each is its own atomic swap — your wallet signs once per offer ({sweep.picked.length || 'N'} signature{sweep.picked.length === 1 ? '' : 's'}). Stops cleanly if you reject one.
          </p>

          <div className="border-t border-ink-600 pt-4">
            <button
              type="button"
              onClick={openSell}
              title={address ? 'List one of your runes (SINGLE|ACP — signing never broadcasts).' : 'Connect your wallet to sell.'}
              className="w-full rounded-btn border border-ink-600 px-4 py-2.5 text-sm font-medium text-text-hi transition hover:border-forge-400 hover:text-forge-400"
            >
              Sell {rune.sym}
            </button>
            <p className="mt-2 text-center text-[11px] text-text-lo">Signing an offer never broadcasts — your rune only moves when a buyer takes it.</p>
          </div>
        </div>
      </div>

      {take && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => take.phase !== 'signing' && setTake(null)}>
          <div className="w-full max-w-md rounded-card border border-ink-600 bg-ink-850 p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-display text-lg text-text-hi">Take rune offer</h4>
            {take.phase === 'building' && <p className="mt-4 text-sm text-text-mid">Tracing the rune + preparing your transaction…</p>}
            {take.phase === 'error' && (
              <>
                <p className="mt-4 text-sm text-red-300">{take.msg}</p>
                <button type="button" onClick={() => setTake(null)} className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Close</button>
              </>
            )}
            {take.phase === 'signing' && (
              <>
                <p className="mt-4 text-sm text-text-mid">Sign in your wallet, then we verify + broadcast…</p>
                <button type="button" onClick={() => setTake(null)} className="mt-4 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-lo">Close</button>
              </>
            )}
            {take.phase === 'done' && (
              <>
                <p className="mt-4 text-sm text-emerald-300">Swap broadcast ✓ — the rune is yours.</p>
                <a href={`${EXPLORER}/tx/${take.txid}`} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all font-mono text-xs text-forge-400 hover:underline">{take.txid}</a>
                <button type="button" onClick={() => setTake(null)} className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Close</button>
              </>
            )}
            {take.phase === 'confirm' && take.plan && (
              <>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-text-lo">You receive</dt><dd className="font-mono text-text-hi">{take.plan.amount.toString()} {take.plan.runeName}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-lo">You pay</dt><dd className="font-mono text-text-hi">{take.plan.price.toLocaleString()} sats</dd></div>
                  <div className="flex justify-between"><dt className="text-text-lo">Network fee</dt><dd className="font-mono text-text-mid">{take.plan.fee.toLocaleString()} sats</dd></div>
                  <div className="flex justify-between"><dt className="text-text-lo">To seller</dt><dd className="font-mono text-text-mid">{short(take.plan.sellerAddr)}</dd></div>
                </dl>
                <p className="mt-3 rounded-btn bg-ink-800 p-3 text-[11px] leading-relaxed text-text-lo">
                  Your wallet signs <span className="text-text-mid">only your $BELLS funding input</span>. We re-traced the rune (it really holds{' '}
                  {take.plan.amount.toString()} {take.plan.runeName}) and the anti-burn guard verified the rune lands on you before broadcast.
                </p>
                <div className="mt-5 flex gap-3">
                  <button type="button" onClick={() => setTake(null)} className="flex-1 rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Cancel</button>
                  <button type="button" onClick={confirmTake} className="flex-1 rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-110">Sign & broadcast</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {sell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => sell.phase !== 'signing' && setSell(null)}>
          <div className="w-full max-w-md rounded-card border border-ink-600 bg-ink-850 p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-display text-lg text-text-hi">Sell a rune</h4>
            {sell.phase === 'scanning' && <p className="mt-4 text-sm text-text-mid">Scanning your wallet for rune UTXOs…</p>}
            {sell.phase === 'building' && <p className="mt-4 text-sm text-text-mid">Building your SINGLE|ACP offer…</p>}
            {sell.phase === 'signing' && (
              <>
                <p className="mt-4 text-sm text-text-mid">Sign in your wallet — this does <span className="text-text-mid">not</span> broadcast, it only creates the offer…</p>
                <button type="button" onClick={() => setSell(null)} className="mt-4 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-lo">Close</button>
              </>
            )}
            {sell.phase === 'error' && (
              <>
                <p className="mt-4 text-sm text-red-300">{sell.msg}</p>
                <button type="button" onClick={() => setSell(null)} className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Close</button>
              </>
            )}
            {sell.phase === 'done' && (
              <>
                <p className="mt-4 text-sm text-emerald-300">Offer signed + listed ✓ — it's live on the board. Nothing was broadcast; the rune moves only when a buyer takes it.</p>
                <button type="button" onClick={() => setSell(null)} className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Close</button>
              </>
            )}
            {sell.phase === 'pick' && sell.utxos && (
              <>
                <p className="mt-3 text-xs text-text-lo">Pick a rune UTXO to list, set your price in sats, then your wallet signs a SINGLE|ANYONECANPAY offer. Signing never broadcasts.</p>
                <label className="mt-4 block text-xs uppercase tracking-wide text-text-lo">Price (sats)</label>
                <input
                  type="number"
                  min={546}
                  step={1}
                  value={sell.price ?? ''}
                  onChange={(e) => setSell((s) => (s ? { ...s, price: e.target.value, msg: undefined } : s))}
                  placeholder="e.g. 1000"
                  className="mt-1 w-full rounded-btn border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-text-hi outline-none focus:border-forge-400"
                />
                {sell.msg && <p className="mt-2 text-xs text-red-300">{sell.msg}</p>}
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
                  {sell.utxos.map((u) => (
                    <button
                      key={`${u.txid}:${u.vout}`}
                      type="button"
                      onClick={() => startOffer(u)}
                      className="flex w-full items-center justify-between rounded-btn border border-ink-600 bg-ink-800 px-3 py-2 text-left transition hover:border-forge-400"
                    >
                      <span>
                        <span className="font-mono text-sm text-text-hi">{u.amount.toString()} {u.runeName}</span>
                        <span className="block font-mono text-[10px] text-text-lo">{u.txid.slice(0, 12)}…:{u.vout} · {u.value} sats</span>
                      </span>
                      <span className="font-micro text-[10px] uppercase tracking-wide text-forge-400">List →</span>
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setSell(null)} className="mt-4 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Cancel</button>
              </>
            )}
            {sell.phase === 'confirm' && sell.draft && (
              <>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-text-lo">You sell</dt><dd className="font-mono text-text-hi">{sell.draft.amount.toString()} {sell.draft.runeName}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-lo">You receive</dt><dd className="font-mono text-text-hi">{sell.draft.price.toLocaleString()} sats</dd></div>
                  <div className="flex justify-between"><dt className="text-text-lo">Rune UTXO</dt><dd className="font-mono text-text-mid">{sell.draft.runeUtxo.slice(0, 12)}…</dd></div>
                </dl>
                <p className="mt-3 rounded-btn bg-ink-800 p-3 text-[11px] leading-relaxed text-text-lo">
                  Your wallet signs the rune input with <span className="text-text-mid">SIGHASH_SINGLE|ANYONECANPAY</span> — this commits only to your payment, never broadcasts, and
                  cannot burn the rune. We verify the wallet returned a real 0x83 signature before listing.
                </p>
                <div className="mt-5 flex gap-3">
                  <button type="button" onClick={() => setSell({ phase: 'pick', utxos: sell.utxos, price: sell.price })} className="flex-1 rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Back</button>
                  <button type="button" onClick={confirmOffer} className="flex-1 rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-110">Sign offer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {sweepRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => sweepRun.phase === 'done' && setSweepRun(null)}>
          <div className="w-full max-w-md rounded-card border border-ink-600 bg-ink-850 p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-display text-lg text-text-hi">Sweep {rune.sym}</h4>
            <p className="mt-2 text-sm text-text-mid">
              {sweepRun.phase === 'running'
                ? `Taking offer ${sweepRun.done + 1} of ${sweepRun.total} — sign each in your wallet…`
                : `Done — ${sweepRun.results.filter((r) => r.txid).length} of ${sweepRun.total} filled.`}
            </p>
            <div className="mt-4 max-h-60 space-y-2 overflow-y-auto">
              {sweepRun.results.map((r, i) => (
                <div key={r.id + i} className="flex items-center justify-between rounded-btn border border-ink-600 bg-ink-900 px-3 py-2 text-xs">
                  <span className="text-text-lo">{r.price.toLocaleString()} sats</span>
                  {r.txid ? (
                    <a href={`${EXPLORER}/tx/${r.txid}`} target="_blank" rel="noopener noreferrer" className="font-mono text-emerald-300 hover:underline">✓ {r.txid.slice(0, 10)}…</a>
                  ) : (
                    <span className="max-w-[60%] truncate text-right text-red-300" title={r.error}>✕ {r.error}</span>
                  )}
                </div>
              ))}
              {sweepRun.phase === 'running' && sweepRun.results.length < sweepRun.total && (
                <div className="rounded-btn border border-dashed border-ink-600 px-3 py-2 text-center text-xs text-text-lo">signing…</div>
              )}
            </div>
            {sweepRun.phase === 'running' ? (
              <button
                type="button"
                onClick={() => {
                  sweepCancelled.current = true
                  setSweepRun(null)
                }}
                className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi"
              >
                Stop sweep
              </button>
            ) : (
              <button type="button" onClick={() => setSweepRun(null)} className="mt-5 w-full rounded-btn bg-ink-700 px-4 py-2 text-sm text-text-hi">Close</button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
