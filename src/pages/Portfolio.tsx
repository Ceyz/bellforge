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
import { asset, DOCS_URL } from '../config'

type Bal = { state: 'idle' | 'loading' | 'error'; bells: number | null }

export function Portfolio() {
  const { address, network } = useWallet()
  const reduce = useReducedMotion()
  const [bal, setBal] = useState<Bal>({ state: 'idle', bells: null })
  const [, setActivity] = useState<Activity[]>([])

  useEffect(() => {
    if (!address) {
      setBal({ state: 'idle', bells: null })
      setActivity([])
      return
    }
    let alive = true
    setBal({ state: 'loading', bells: null })
    fetchBellsBalance(address).then((r) => {
      if (alive) setBal('error' in r ? { state: 'error', bells: null } : { state: 'idle', bells: r.bells })
    })
    fetchActivity(address).then((r) => {
      if (alive && !('error' in r)) setActivity(r)
    })
    return () => {
      alive = false
    }
  }, [address])

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
        <PageHeader title="Portfolio" subtitle="Your $BELLS, your forge level and every move you make on Bellscoin." />
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
            regtest · zero real value{network ? ` · ${network}` : ''} · {address}
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
                    <th className="px-5 py-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-600">
                  <tr>
                    <td className="px-5 py-4"><span className="font-mono text-text-hi">$BELLS</span></td>
                    <td className="px-5 py-4 font-mono text-text-mid">{balText}</td>
                    <td className="px-5 py-4 text-text-lo">electrs (live)</td>
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
            <h3 className="mb-3 font-display text-text-hi">Recent activity</h3>
            <div className="rounded-card border border-ink-600 bg-ink-800/60">
              <ForgeEmpty
                icon="anvil"
                title="No transactions yet"
                body="Every signed transaction you broadcast lands here, straight from the chain."
                to="/app/trade"
                cta="Make your first move"
              />
            </div>
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
