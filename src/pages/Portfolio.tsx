import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet } from '../wallet/WalletProvider'
import { fetchBellsBalance } from '../lib/chain'
import { ConnectWallet } from '../components/app/ConnectWallet'
import { PageHeader } from '../components/app/PageHeader'
import { asset } from '../config'

type Bal = { state: 'idle' | 'loading' | 'error'; bells: number | null }

export function Portfolio() {
  const { address, network } = useWallet()
  const [bal, setBal] = useState<Bal>({ state: 'idle', bells: null })

  useEffect(() => {
    if (!address) {
      setBal({ state: 'idle', bells: null })
      return
    }
    let alive = true
    setBal({ state: 'loading', bells: null })
    fetchBellsBalance(address).then((r) => {
      if (!alive) return
      setBal('error' in r ? { state: 'error', bells: null } : { state: 'idle', bells: r.bells })
    })
    return () => {
      alive = false
    }
  }, [address])

  const balText =
    bal.state === 'loading'
      ? '…'
      : bal.state === 'error'
        ? 'unavailable'
        : bal.bells === null
          ? '—'
          : bal.bells.toLocaleString(undefined, { maximumFractionDigits: 8 })

  return (
    <>
      <PageHeader title="Portfolio" subtitle="Your $BELLS and OP_CAT token balances on Bellscoin." />

      {!address ? (
        <div className="rounded-card border border-ink-600 bg-ink-800/60 p-10 text-center">
          <img src={asset('icons/bound-ingot.png')} alt="" aria-hidden="true" className="pixelated mx-auto mb-4 h-12 w-12 opacity-80" />
          <p className="text-text-mid">Connect your wallet to see your balances.</p>
          <div className="mt-5 flex justify-center">
            <ConnectWallet />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-ink-600 bg-ink-800/60 p-5">
              <p className="text-xs text-text-lo">Address{network ? ` · ${network}` : ''}</p>
              <p className="mt-1 break-all font-mono text-sm text-text-hi">{address}</p>
            </div>
            <div className="rounded-card border border-ink-600 bg-ink-800/60 p-5">
              <p className="text-xs text-text-lo">$BELLS balance</p>
              <p className="mt-1 font-mono text-2xl text-text-hi">
                {balText} <span className="text-base text-text-mid">BELLS</span>
              </p>
            </div>
          </div>

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
              </tbody>
            </table>
          </div>
          <p className="text-center text-xs text-text-lo">
            No OP_CAT tokens yet — they’ll appear here once you mint or receive them.{' '}
            <Link to="/app/mint" className="text-forge-400 transition hover:underline">
              Mint one →
            </Link>
          </p>
        </div>
      )}
    </>
  )
}
