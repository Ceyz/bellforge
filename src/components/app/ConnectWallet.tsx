import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useWallet } from '../../wallet/WalletProvider'
import { Button } from '../ui/Button'

function shorten(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function ConnectWallet({ className = '' }: { className?: string }) {
  const { address, network, connect, disconnect, connecting, available } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const reduce = useReducedMotion()
  const popoverId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)

  // Move focus into the menu on open; return it to the trigger on close.
  useEffect(() => {
    if (open) firstActionRef.current?.focus()
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

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
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={`Wallet menu — ${shorten(address)}`}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        className="inline-flex items-center gap-2 rounded-btn border border-ink-600 bg-ink-800 px-3.5 py-2 text-sm font-medium text-text-hi transition hover:border-zinc-500 hover:shadow-[0_0_18px_-8px_var(--color-live-500)]"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span
            className="absolute inline-flex h-full w-full rounded-full bg-live-500 opacity-60"
            style={{ animation: reduce ? undefined : 'ember-breathe 2.6s ease-in-out infinite' }}
          />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live-500" />
        </span>
        <span className="font-mono text-xs">{shorten(address)}</span>
      </motion.button>

      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
      <AnimatePresence>
        {open && (
          <motion.div
            id={popoverId}
            role="dialog"
            aria-label="Wallet menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
            }}
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 z-40 mt-2 w-60 origin-top-right rounded-card border border-ink-600 bg-ink-850 p-2 shadow-xl shadow-black/50"
          >
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-lo">
              Connected{network ? ` · ${network}` : ''}
            </div>
            <p className="break-all px-2 pb-2 font-mono text-xs text-text-mid">{address}</p>
            <button
              ref={firstActionRef}
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
                close()
              }}
              className="w-full rounded-btn px-2 py-1.5 text-left text-sm text-text-mid transition hover:bg-ink-700 hover:text-text-hi"
            >
              Disconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
