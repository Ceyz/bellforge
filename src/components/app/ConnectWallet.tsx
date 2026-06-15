import { useWallet } from '../../wallet/WalletProvider'
import { Button } from '../ui/Button'

function shorten(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function ConnectWallet({ className = '' }: { className?: string }) {
  const { address, connect, disconnect, connecting, available } = useWallet()

  if (address) {
    return (
      <button
        type="button"
        onClick={disconnect}
        title="Click to disconnect"
        className={`inline-flex items-center gap-2 rounded-btn border border-ink-600 bg-ink-800 px-3.5 py-2 text-sm font-medium text-text-hi transition hover:border-zinc-500 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-xs">{shorten(address)}</span>
      </button>
    )
  }

  return (
    <Button onClick={connect} disabled={connecting} className={`px-4 py-2 ${className}`}>
      {connecting ? 'Connecting…' : available ? 'Connect wallet' : 'Get Nintondo wallet'}
    </Button>
  )
}
