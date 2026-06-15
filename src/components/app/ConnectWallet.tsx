import { useState } from 'react'
import { useWallet } from '../../wallet/WalletProvider'
import { Button } from '../ui/Button'

function shorten(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function ConnectWallet({ className = '' }: { className?: string }) {
  const { address, network, connect, disconnect, connecting, available } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!address) {
    return (
      <Button onClick={connect} disabled={connecting} className={`px-4 py-2 ${className}`}>
        {connecting ? 'Connecting…' : available ? 'Connect wallet' : 'Get Nintondo wallet'}
      </Button>
    )
  }

  const copy = () => {
    navigator.clipboard?.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-btn border border-ink-600 bg-ink-800 px-3.5 py-2 text-sm font-medium text-text-hi transition hover:border-zinc-500"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-mono text-xs">{shorten(address)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-60 rounded-card border border-ink-600 bg-ink-850 p-2 shadow-xl shadow-black/50">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-lo">
              Connected{network ? ` · ${network}` : ''}
            </div>
            <p className="break-all px-2 pb-2 font-mono text-xs text-text-mid">{address}</p>
            <button
              type="button"
              onClick={copy}
              className="w-full rounded-btn px-2 py-1.5 text-left text-sm text-text-hi transition hover:bg-ink-700"
            >
              {copied ? 'Copied ✓' : 'Copy address'}
            </button>
            <button
              type="button"
              onClick={() => {
                disconnect()
                setOpen(false)
              }}
              className="w-full rounded-btn px-2 py-1.5 text-left text-sm text-text-mid transition hover:bg-ink-700 hover:text-text-hi"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  )
}
