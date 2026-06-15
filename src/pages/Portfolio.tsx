import { Link } from 'react-router-dom'
import { useWallet } from '../wallet/WalletProvider'
import { ConnectWallet } from '../components/app/ConnectWallet'
import { PageHeader } from '../components/app/PageHeader'

export function Portfolio() {
  const { address } = useWallet()
  return (
    <>
      <PageHeader title="Portfolio" subtitle="Your $BELLS and OP_CAT token balances on Bellscoin." />

      {!address ? (
        <div className="rounded-card border border-ink-600 bg-ink-800/60 p-10 text-center">
          <p className="text-text-mid">Connect your wallet to see your balances.</p>
          <div className="mt-5 flex justify-center">
            <ConnectWallet />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-card border border-ink-600 bg-ink-800/60 p-5">
            <p className="text-xs text-text-lo">Connected</p>
            <p className="break-all font-mono text-sm text-text-hi">{address}</p>
          </div>
          <div className="overflow-hidden rounded-card border border-ink-600">
            <table className="w-full text-sm">
              <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-text-lo">
                <tr>
                  <th className="px-5 py-3 font-medium">Token</th>
                  <th className="px-5 py-3 font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                <tr>
                  <td className="px-5 py-4"><span className="font-mono text-text-hi">$BELLS</span></td>
                  <td className="px-5 py-4 font-mono text-text-mid">—</td>
                  <td className="px-5 py-4 text-text-lo">regtest</td>
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
