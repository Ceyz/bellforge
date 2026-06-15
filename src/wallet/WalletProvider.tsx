import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type NintondoApi = {
  requestAccounts?: () => Promise<string[]>
  connect?: () => Promise<{ address?: string } | string[]>
  getAccounts?: () => Promise<string[]>
}

declare global {
  interface Window {
    nintondo?: NintondoApi
  }
}

type WalletState = {
  address: string | null
  connecting: boolean
  available: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

const Ctx = createContext<WalletState | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const available = typeof window !== 'undefined' && !!window.nintondo

  const connect = useCallback(async () => {
    const w = typeof window !== 'undefined' ? window.nintondo : undefined
    if (!w) {
      window.open('https://nintondo.io', '_blank', 'noopener')
      return
    }
    setConnecting(true)
    try {
      let accts: string[] | undefined
      if (typeof w.requestAccounts === 'function') accts = await w.requestAccounts()
      else if (typeof w.getAccounts === 'function') accts = await w.getAccounts()
      else if (typeof w.connect === 'function') {
        const r = await w.connect()
        accts = Array.isArray(r) ? r : r?.address ? [r.address] : undefined
      }
      if (accts && accts.length) setAddress(accts[0])
    } catch {
      /* user rejected or API mismatch — stay disconnected */
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => setAddress(null), [])

  return (
    <Ctx.Provider value={{ address, connecting, available, connect, disconnect }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWallet must be used within WalletProvider')
  return c
}
