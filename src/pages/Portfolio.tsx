import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useWallet } from '../wallet/WalletProvider'
import { fetchBellsBalance, fetchActivity, type Activity } from '../lib/chain'
import { ConnectWallet } from '../components/app/ConnectWallet'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'
import { LinkButton } from '../components/ui/Button'
import { EmberDot } from '../components/ui/EmberDot'
import { OdometerNumber } from '../components/juice/OdometerNumber'
import { ForgeEmpty } from '../components/juice/ForgeEmpty'
import { HonestBanner } from '../components/ui/HonestBanner'
import { type RuneBalance } from '../lib/runes'
import { traceRuneBalances } from '../lib/runeSwap'
import { fetchMyOffers, cancelOffer, type Offer } from '../lib/offers'
import { asset, DOCS_URL, EXPLORER, explorerAddress, explorerTx } from '../config'

const RUNE_NAMES: Record<string, string> = { '1:0': 'NINTONDO', '350000:1': 'NOOK•IN•BELLS' }

type Bal = { state: 'idle' | 'loading' | 'error'; bells: number | null; txCount: number }

const fmtBells = (sats: number) => (sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })

function ago(sec: number) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

export function Portfolio() {
  const { address, network } = useWallet()
  const reduce = useReducedMotion()
  const [bal, setBal] = useState<Bal>({ state: 'idle', bells: null, txCount: 0 })
  const [activity, setActivity] = useState<Activity[]>([])
  const [runes, setRunes] = useState<{ state: 'idle' | 'loading' | 'error'; rows: RuneBalance[]; capped: boolean }>({ state: 'idle', rows: [], capped: false })
  const [myOffers, setMyOffers] = useState<{ state: 'idle' | 'loading'; rows: Offer[] }>({ state: 'idle', rows: [] })
  const [cancelling, setCancelling] = useState<string | null>(null)

  useEffect(() => {
    if (!address) {
      setBal({ state: 'idle', bells: null, txCount: 0 })
      setActivity([])
      setRunes({ state: 'idle', rows: [], capped: false })
      setMyOffers({ state: 'idle', rows: [] })
      return
    }
    let alive = true
    setBal({ state: 'loading', bells: null, txCount: 0 })
    setRunes({ state: 'loading', rows: [], capped: false })
    setMyOffers({ state: 'loading', rows: [] })
    fetchBellsBalance(address).then((r) => {
      if (alive) setBal('error' in r ? { state: 'error', bells: null, txCount: 0 } : { state: 'idle', bells: r.bells, txCount: r.txCount })
    })
    fetchActivity(address).then((r) => {
      if (alive && !('error' in r)) setActivity(r)
    })
    // EXACT balances via lineage replay — resolves runes received through a swap/transfer
    // edict, which the simple per-tx decoder (runes.ts) attributes 0 to.
    traceRuneBalances(address).then((r) => {
      if (alive) setRunes('error' in r ? { state: 'error', rows: [], capped: false } : { state: 'idle', rows: r.rows, capped: r.capped })
    })
    fetchMyOffers(address).then((r) => {
      if (alive) setMyOffers({ state: 'idle', rows: 'offers' in r ? r.offers : [] })
    })
    return () => {
      alive = false
    }
  }, [address])

  async function onCancel(id: string) {
    setCancelling(id)
    const ok = await cancelOffer(id)
    setCancelling(null)
    if (ok) setMyOffers((m) => ({ ...m, rows: m.rows.filter((o) => o.id !== id) }))
  }

  if (!address) {
    return (
      <PageItem className="rounded-card border border-ink-600 bg-ink-800/60 p-10 text-center">
        <img src={asset('icons/bound-ingot.png')} alt="" aria-hidden className="pixelated ingot-idle mx-auto mb-4 h-12 w-12" />
        <p className="text-text-mid">Connect your wallet to see your portfolio.</p>
        <div className="mt-5 flex justify-center">
          <ConnectWallet />
        </div>
      </PageItem>
    )
  }

  const balText =
    bal.state === 'loading'
      ? '…'
      : bal.state === 'error'
        ? 'unavailable'
        : bal.bells === null
          ? '—'
          : bal.bells.toLocaleString(undefined, { maximumFractionDigits: 8 })

  const live = bal.state === 'idle' && bal.bells !== null

  return (
    <>
      <PageItem>
        <PageHeader title="Portfolio" subtitle="Your $BELLS balance and on-chain activity on Bellscoin." />
      </PageItem>

      <PageItem className="relative mb-6 overflow-hidden rounded-card border border-ink-600 bg-gradient-to-b from-ink-800 to-ink-900 p-7">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-forge-500/10 blur-3xl"
          animate={reduce ? {} : { opacity: [0.6, 1, 0.6], scale: [1, 1.08, 1] }}
          transition={{ duration: 6, ease: 'easeInOut', repeat: Infinity }}
        />
        <div className="relative">
          <p className="flex items-center gap-1.5 text-xs text-text-lo">Total value {live && <EmberDot />}</p>
          <p className="mt-1 font-mono text-4xl text-text-hi">
            {live ? (
              <OdometerNumber value={bal.bells ?? 0} decimals={8} className="font-mono text-4xl text-text-hi" />
            ) : (
              balText
            )}{' '}
            <span className="text-xl text-text-mid">BELLS</span>
          </p>
          <p className="mt-1 break-all text-xs text-text-lo">
            regtest · zero real value{network ? ` · ${network}` : ''} ·{' '}
            <a
              href={explorerAddress(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-mid underline-offset-2 transition hover:text-forge-400 hover:underline"
            >
              {address}
            </a>
          </p>
        </div>
      </PageItem>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <PageItem>
            <h3 className="mb-3 font-display text-text-hi">Holdings</h3>
            <div className="overflow-hidden rounded-card border border-ink-600">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-text-lo">
                  <tr>
                    <th className="px-5 py-3 font-medium">Token</th>
                    <th className="px-5 py-3 font-medium">Balance</th>
                    <th className="px-5 py-3 font-medium">On-chain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-600">
                  <tr>
                    <td className="px-5 py-4">
                      <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="font-mono text-text-hi transition hover:text-forge-400">
                        $BELLS
                      </a>
                    </td>
                    <td className="px-5 py-4 font-mono text-text-mid">{balText}</td>
                    <td className="px-5 py-4 text-text-lo">
                      <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="transition hover:text-text-hi">
                        {bal.state === 'idle' ? `${bal.txCount.toLocaleString()} txs` : 'electrs'} ↗
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="p-0">
                      <ForgeEmpty
                        icon="mold"
                        title="No OP_CAT tokens yet"
                        body="Deploy one and it appears here, minted from its own covenant."
                        to="/app/deploy"
                        cta="Open the forge"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </PageItem>

          <PageItem>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-text-hi">Runes</h3>
              {runes.state === 'idle' && runes.rows.length > 0 && (
                <span className="text-xs text-text-lo">{runes.capped ? 'sampled (≥)' : `${runes.rows.length} held`}</span>
              )}
            </div>
            {runes.state === 'loading' ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60 p-6 text-center text-sm text-text-mid">Decoding runes from the chain…</div>
            ) : runes.state === 'error' ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60 p-6 text-center text-sm text-text-mid">Couldn’t read rune UTXOs right now.</div>
            ) : runes.rows.length === 0 ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60">
                <ForgeEmpty icon="mold" title="No runes held" body="Runes you hold on this address appear here, decoded live from the chain." to="/app/token" cta="Explore runes" />
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-card border border-ink-600">
                  <table className="w-full text-sm">
                    <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-text-lo">
                      <tr>
                        <th className="px-5 py-3 font-medium">Rune</th>
                        <th className="px-5 py-3 font-medium">Balance</th>
                        <th className="px-5 py-3 font-medium">Rune ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-600">
                      {runes.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="px-5 py-4">
                            <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="font-mono text-text-hi transition hover:text-forge-400">
                              {r.name}
                            </a>
                          </td>
                          <td className="px-5 py-4 font-mono text-text-mid">
                            {r.approx ? '≥ ' : ''}
                            {r.display}
                          </td>
                          <td className="px-5 py-4 font-mono text-text-lo">{r.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <HonestBanner>
                    Rune balances are decoded <span className="text-text-hi">live in your browser</span> from electrs UTXOs — no indexer.
                    {runes.capped ? ' This wallet is large, so the list is sampled — balances are a lower bound (≥).' : ''} Global holders and
                    total supply per rune need the runes indexer (<span className="font-mono">ord.nintondo.io</span>, offline).
                  </HonestBanner>
                </div>
              </>
            )}
          </PageItem>

          <PageItem>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-text-hi">My rune offers</h3>
              {myOffers.rows.length > 0 && <span className="text-xs text-text-lo">{myOffers.rows.length} live</span>}
            </div>
            {myOffers.state === 'loading' ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60 p-6 text-center text-sm text-text-mid">Loading your offers…</div>
            ) : myOffers.rows.length === 0 ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60">
                <ForgeEmpty icon="anvil" title="No live offers" body="Offers you sign in Trade → Sell a rune show here. Signing never broadcasts — cancel anytime." to="/app/trade" cta="Sell a rune" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-card border border-ink-600">
                <table className="w-full text-sm">
                  <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-text-lo">
                    <tr>
                      <th className="px-5 py-3 font-medium">Rune</th>
                      <th className="px-5 py-3 font-medium">Price</th>
                      <th className="px-5 py-3 font-medium">Rune UTXO</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-600">
                    {myOffers.rows.map((o) => (
                      <tr key={o.id}>
                        <td className="px-5 py-4">
                          <span className="font-mono text-text-hi">{RUNE_NAMES[o.rune_id] ?? o.rune_id}</span>
                          {o.amount_hint && <span className="block text-[10px] text-text-lo">~{o.amount_hint} units</span>}
                        </td>
                        <td className="px-5 py-4 font-mono text-text-mid">{o.price.toLocaleString()} sats</td>
                        <td className="px-5 py-4">
                          <a href={`${EXPLORER}/tx/${o.rune_utxo.split(':')[0]}`} target="_blank" rel="noopener noreferrer" className="font-mono text-text-lo transition hover:text-forge-400">
                            {o.rune_utxo.slice(0, 10)}…:{o.rune_utxo.split(':')[1]}
                          </a>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => onCancel(o.id)}
                            disabled={cancelling === o.id}
                            className="rounded-btn border border-ink-600 px-3 py-1.5 text-xs font-medium text-text-hi transition hover:border-red-400/60 hover:text-red-300 disabled:opacity-50"
                          >
                            {cancelling === o.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PageItem>

          <PageItem>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-text-hi">Recent activity</h3>
              {bal.state === 'idle' && bal.txCount > 0 && (
                <span className="text-xs text-text-lo">{bal.txCount.toLocaleString()} total</span>
              )}
            </div>
            {activity.length === 0 ? (
              <div className="rounded-card border border-ink-600 bg-ink-800/60">
                <ForgeEmpty
                  icon="anvil"
                  title="No transactions yet"
                  body="Every signed transaction you broadcast lands here, straight from the chain."
                  to="/app/trade"
                  cta="Make your first move"
                />
              </div>
            ) : (
              <ul className="divide-y divide-ink-600 overflow-hidden rounded-card border border-ink-600 bg-ink-800/60">
                {activity.map((a) => (
                  <li key={a.txid} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="flex items-center gap-2.5">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                          a.dir === 'in' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {a.dir === 'in' ? '↓' : '↑'}
                      </span>
                      <span>
                        <span className="text-text-hi">{a.dir === 'in' ? 'Received' : 'Sent'}</span>
                        <span className="block text-xs text-text-lo">{a.confirmed ? (a.time ? ago(a.time) : 'confirmed') : 'pending'}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={`font-mono ${a.dir === 'in' ? 'text-emerald-300' : 'text-text-hi'}`}>
                        {a.dir === 'in' ? '+' : '−'}
                        {fmtBells(a.sats)} BELLS
                      </span>
                      <a href={explorerTx(a.txid)} target="_blank" rel="noopener noreferrer" title="View on explorer" className="text-text-lo transition hover:text-forge-400">
                        ↗
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PageItem>
        </div>

        <PageItem className="h-fit space-y-3 rounded-card border border-ink-600 bg-ink-800/60 p-5 lg:sticky lg:top-24">
          <h3 className="font-display text-text-hi">Quick actions</h3>
          <LinkButton href="#/app/deploy" className="w-full">Deploy a token</LinkButton>
          <LinkButton href="#/app/token" variant="secondary" className="w-full">Explore tokens</LinkButton>
          <LinkButton href="#/app/trade" variant="secondary" className="w-full">Trade</LinkButton>
          {DOCS_URL !== '#' && (
            <LinkButton href={DOCS_URL} variant="secondary" className="w-full">Read the docs</LinkButton>
          )}
        </PageItem>
      </div>
    </>
  )
}
