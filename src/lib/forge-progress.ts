import { useEffect, useState } from 'react'
import { useWallet } from '../wallet/WalletProvider'
import { fetchBellsBalance } from './chain'
import type { Tier } from '../components/juice/tiers'

/* ---------------------------------------------------------------------------
   Honest gamification spine. XP is the COUNT of completed boolean quests, each
   derived from a verifiable fact — never a continuous metric, so it can never be
   misread as price / holders / volume. Deploy & mint quests flip ONLY on a
   confirmed broadcast receipt, which cannot exist pre-mainnet → structurally 0.
--------------------------------------------------------------------------- */

export type Receipts = { deploys: string[]; mints: string[] }
const RKEY = (addr: string) => `bf:receipts:${addr}`
const EXPLORED = 'bf:quest:explored'
const EVENT = 'bf:progress'

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function readReceipts(addr: string | null): Receipts {
  if (!addr || typeof localStorage === 'undefined') return { deploys: [], mints: [] }
  try {
    const raw = localStorage.getItem(RKEY(addr))
    if (!raw) return { deploys: [], mints: [] }
    const p = JSON.parse(raw) as Partial<Receipts>
    return { deploys: p.deploys ?? [], mints: p.mints ?? [] }
  } catch {
    return { deploys: [], mints: [] }
  }
}

/** Record a confirmed-broadcast receipt (mainnet only). Pre-mainnet this is never
    called, so the deploy/mint quests stay structurally incomplete. */
export function recordReceipt(addr: string, kind: 'deploys' | 'mints', txid: string) {
  if (typeof localStorage === 'undefined') return
  const r = readReceipts(addr)
  if (!r[kind].includes(txid)) r[kind].push(txid)
  localStorage.setItem(RKEY(addr), JSON.stringify(r))
  emit()
}

/** Mark the "inspect a covenant token" quest — called from a Token page. Honest:
    the user really did open a token page. */
export function markExplored() {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(EXPLORED) !== '1') {
    localStorage.setItem(EXPLORED, '1')
    emit()
  }
}

export type ForgeFacts = {
  connected: boolean
  bells: number | null
  bellsKnown: boolean
  explored: boolean
  tokensDeployed: number
  mintsJoined: number
}

export type Quest = { id: string; title: string; hint: string; done: boolean; evidence: string }

export function questsFor(f: ForgeFacts): Quest[] {
  return [
    {
      id: 'connect',
      title: 'Light the forge',
      hint: 'Connect your Bells wallet.',
      done: f.connected,
      evidence: 'Wallet connected.',
    },
    {
      id: 'fund',
      title: 'Stock the coal',
      hint: 'Hold any $BELLS to fuel the forge.',
      done: f.bellsKnown && (f.bells ?? 0) > 0,
      evidence: f.bells != null ? `${f.bells.toLocaleString(undefined, { maximumFractionDigits: 8 })} $BELLS in wallet.` : 'Holding $BELLS.',
    },
    {
      id: 'explore',
      title: 'Inspect the anvil',
      hint: 'Open a token page and read its covenant.',
      done: f.explored,
      evidence: 'Inspected a covenant token.',
    },
    {
      id: 'deploy',
      title: 'Forge your first token',
      hint: 'Deploy a new OP_CAT token (mainnet).',
      done: f.tokensDeployed > 0,
      evidence: f.tokensDeployed > 0 ? `${f.tokensDeployed} token(s) deployed.` : 'Live at mainnet.',
    },
    {
      id: 'mint',
      title: 'Strike the mint',
      hint: 'Mint your share from a token (mainnet).',
      done: f.mintsJoined > 0,
      evidence: f.mintsJoined > 0 ? `${f.mintsJoined} mint(s) joined.` : 'Live at mainnet.',
    },
  ]
}

export type Rank = { name: string; tier: Tier }

/** done count → rank. Pre-mainnet the deploy/mint quests are unreachable, so the
    ladder tops out at Smith (3 of 5). */
export function rankFor(done: number): Rank {
  if (done >= 5) return { name: 'Grandmaster', tier: 'ember' }
  if (done >= 4) return { name: 'Forgemaster', tier: 'gold' }
  if (done >= 2) return { name: 'Smith', tier: 'silver' }
  if (done >= 1) return { name: 'Apprentice', tier: 'bronze' }
  return { name: 'Cold Iron', tier: 'iron' }
}

export function useForgeProgress() {
  const { address } = useWallet()
  const [facts, setFacts] = useState<ForgeFacts>({
    connected: false,
    bells: null,
    bellsKnown: false,
    explored: false,
    tokensDeployed: 0,
    mintsJoined: 0,
  })

  useEffect(() => {
    let alive = true
    const explored = typeof localStorage !== 'undefined' && localStorage.getItem(EXPLORED) === '1'
    const r = readReceipts(address ?? null)
    const base: ForgeFacts = {
      connected: !!address,
      bells: null,
      bellsKnown: false,
      explored,
      tokensDeployed: r.deploys.length,
      mintsJoined: r.mints.length,
    }
    setFacts(base)
    if (address) {
      fetchBellsBalance(address).then((res) => {
        if (!alive) return
        if ('error' in res) setFacts((f) => ({ ...f, bells: null, bellsKnown: false }))
        else setFacts((f) => ({ ...f, bells: res.bells, bellsKnown: true }))
      })
    }
    const refresh = () => {
      if (!alive) return
      const ex = typeof localStorage !== 'undefined' && localStorage.getItem(EXPLORED) === '1'
      const rr = readReceipts(address ?? null)
      setFacts((f) => ({ ...f, explored: ex, tokensDeployed: rr.deploys.length, mintsJoined: rr.mints.length }))
    }
    window.addEventListener(EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [address])

  const quests = questsFor(facts)
  const done = quests.filter((q) => q.done).length
  const total = quests.length
  const rank = rankFor(done)
  return { facts, quests, done, total, rank, address }
}
