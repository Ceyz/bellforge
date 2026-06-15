import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/** The subset of window.nintondo we use. API confirmed against extension v0.3.10
    (Bellbound/Islebound integration): NO requestAccounts/getAccounts — connect()
    then getAccount(). getNetwork() is unreliable. The extension injects ASYNC. */
interface NintondoProvider {
  connect: (network?: string) => Promise<unknown>
  getAccount?: () => Promise<unknown>
  isConnected?: () => Promise<boolean>
  disconnect?: () => Promise<void>
}

declare global {
  interface Window {
    nintondo?: NintondoProvider
  }
}

const STORAGE_KEY = 'bf:wallet:connected'

function pickAddress(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return pickAddress(value[0])
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    for (const k of ['address', 'account', 'selectedAddress']) {
      if (typeof o[k] === 'string') return o[k] as string
    }
  }
  return null
}

/** The Nintondo extension injects window.nintondo asynchronously — poll for it. */
function waitForWallet(timeoutMs = 3000): Promise<NintondoProvider | null> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null)
    if (window.nintondo) return resolve(window.nintondo)
    const start = Date.now()
    const id = window.setInterval(() => {
      if (window.nintondo) {
        window.clearInterval(id)
        resolve(window.nintondo)
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(id)
        resolve(null)
      }
    }, 250)
  })
}

function networkOf(address: string | null): 'mainnet' | 'testnet' | null {
  if (!address) return null
  return /^tb/i.test(address) ? 'testnet' : 'mainnet'
}

type WalletState = {
  address: string | null
  network: 'mainnet' | 'testnet' | null
  connecting: boolean
  available: boolean
  connect: () => Promise<void>
  disconnect: () => void
}

const Ctx = createContext<WalletState | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [available, setAvailable] = useState(false)

  // Detect the async-injected extension; silently restore a prior connection.
  useEffect(() => {
    let alive = true
    waitForWallet().then(async (p) => {
      if (!alive || !p) return
      setAvailable(true)
      if (localStorage.getItem(STORAGE_KEY) === '1' && p.getAccount) {
        try {
          const addr = pickAddress(await p.getAccount())
          if (alive && addr) setAddress(addr)
        } catch {
          /* not authorized this session — wait for a manual connect */
        }
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const p = await waitForWallet()
      if (!p) {
        window.open('https://nintondo.io', '_blank', 'noopener')
        return
      }
      setAvailable(true)
      const result = await p.connect()
      let addr = pickAddress(result)
      if (!addr && p.getAccount) addr = pickAddress(await p.getAccount())
      if (addr) {
        setAddress(addr)
        localStorage.setItem(STORAGE_KEY, '1')
      }
    } catch {
      /* user rejected the popup — stay disconnected */
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setAddress(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <Ctx.Provider value={{ address, network: networkOf(address), connecting, available, connect, disconnect }}>
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
