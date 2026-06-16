import type { Status } from '../components/ui/StatusPill'

export type TokenType = 'native' | 'opcat'
/** Which on-chain protocol backs the token. Existing entries default to 'opcat'. */
export type TokenProtocol = 'opcat' | 'rune'

export type TokenInfo = {
  id: string
  sym: string
  name: string
  tag: string
  type: TokenType
  /** omit ⇒ 'opcat'. Runes are a separate protocol shown via the explorer filter. */
  protocol?: TokenProtocol
  /** "block:idx" for rune-backed entries. */
  runeId?: string
  status: Status
  sprite?: string
  network: string
  /** One line: what it is + (for $BOUND) that it is NOT Bellforge's own token. */
  origin: string
  blurb: string
  // OP_CAT-token economics (omitted for native coins):
  cap?: number
  minted?: number
  decimals?: number
  /** Holder count — populated by the P4 indexer at mainnet. undefined ⇒ honest 0/— today. */
  holders?: number
  mintModel?: string
  /** Donut distribution; a single 100% slice = fair mint. */
  distribution?: { label: string; pct: number }[]
  facts: { k: string; v: string; note: string }[]
  guarantees: { title: string; body: string }[]
}

const COVENANT_GUARANTEES: TokenInfo['guarantees'] = [
  {
    title: 'One-shot minter',
    body: 'The genesis minter is spent in the same transaction it creates supply. After genesis, no path can ever mint another unit.',
  },
  {
    title: 'Conservation',
    body: 'Every transfer covenant checks inputs == outputs on-chain. The amount is conserved across splits and merges — no inflation is representable.',
  },
  {
    title: 'Owner-auth',
    body: 'A note only moves when the holder’s key signs (BIP-342). The covenant rejects spends that are not owner-authorized.',
  },
  {
    title: 'Verifiable by anyone',
    body: 'The rules live in tapscript on Bellscoin. Anyone can replay the lineage from genesis on a block explorer — no trusted indexer required.',
  },
]

export const TOKENS: Record<string, TokenInfo> = {
  bells: {
    id: 'bells',
    sym: '$BELLS',
    name: 'Bellscoin',
    tag: 'Native coin',
    type: 'native',
    status: 'live-regtest',
    network: 'Bellscoin',
    origin:
      'The native coin of Bellscoin — not a covenant token. Secured by proof-of-work, it is the gas and the base pair every token trades against.',
    blurb: 'The base asset and gas of Bellscoin — the liquidity anchor every pair trades against.',
    facts: [
      { k: 'Type', v: 'Native coin', note: 'The chain’s base asset, not an OP_CAT token' },
      { k: 'Security', v: 'Proof-of-work', note: 'Secured by Bellscoin (AuxPoW) consensus' },
      { k: 'Role', v: 'Gas + base pair', note: 'Every token trades against $BELLS' },
      { k: 'OP_CAT', v: 'Active', note: 'The covenant bundle is live on mainnet' },
    ],
    guarantees: [],
  },
  bound: {
    id: 'bound',
    sym: '$BOUND',
    name: 'Bound',
    tag: 'First OP_CAT token',
    type: 'opcat',
    status: 'live-regtest',
    sprite: 'icons/bound-ingot.png',
    network: 'Bellscoin',
    origin:
      'The Bellbound game’s premium token, and the first OP_CAT token minted on Bellscoin — the reference the standard was proven with. It is the game’s token, not Bellforge’s.',
    blurb: 'The game’s premium token and the first OP_CAT token on Bellscoin — divisible, covenant-secured.',
    cap: 21_000_000,
    minted: 0,
    decimals: 8,
    mintModel: 'Fair mint',
    distribution: [{ label: 'Fair mint', pct: 100 }],
    facts: [
      { k: 'Planned cap', v: '21,000,000', note: 'Fixed at genesis — never increases' },
      { k: 'Divisibility', v: '8 decimals', note: 'Splittable to 0.00000001' },
      { k: 'Mint model', v: 'Fair mint', note: 'No premine, no team allocation' },
      { k: 'Network', v: 'Bellscoin', note: 'Regtest today · mainnet after audit' },
    ],
    guarantees: COVENANT_GUARANTEES,
  },
  nintondo: {
    id: 'nintondo',
    sym: 'NINTONDO',
    name: 'Nintondo',
    tag: 'Rune',
    type: 'opcat',
    protocol: 'rune',
    runeId: '1:0',
    status: 'live-mainnet',
    network: 'Bellscoin',
    origin:
      'The flagship Bellscoin Rune (RuneId 1:0) — a Runes-protocol token (Casey Rodarmor’s Runes), not an OP_CAT covenant token and not Bellforge’s. It is a reserved rune with no on-chain etch, mintable one unit per transaction.',
    blurb: 'The flagship Bellscoin Rune (1:0). A Runes-protocol token, mass-minted one unit at a time.',
    facts: [
      { k: 'Protocol', v: 'Runes', note: 'Casey Rodarmor’s Runes, on Bellscoin' },
      { k: 'Rune ID', v: '1:0', note: 'Reserved rune — no on-chain etch' },
      { k: 'Per mint', v: '1 unit', note: 'One unit minted per transaction' },
      { k: 'Holders / supply', v: '—', note: 'Need the runes indexer (ord.nintondo.io, offline)' },
    ],
    guarantees: [],
  },
  nookinbells: {
    id: 'nookinbells',
    sym: 'NOOK•IN•BELLS',
    name: 'Nook in Bells',
    tag: 'Rune',
    type: 'opcat',
    protocol: 'rune',
    runeId: '350000:1',
    status: 'live-mainnet',
    network: 'Bellscoin',
    origin:
      'A Bellscoin Rune etched at block 350000 (RuneId 350000:1). A Runes-protocol token with a premine and a capped open mint — not an OP_CAT covenant token.',
    blurb: 'A Bellscoin Rune (350000:1) — etched with a premine and a capped open mint.',
    facts: [
      { k: 'Protocol', v: 'Runes', note: 'Etched on-chain at block 350000' },
      { k: 'Rune ID', v: '350000:1', note: 'block:tx index of the etch' },
      { k: 'Mint cap', v: '60,000,000', note: '1,000 units per mint' },
      { k: 'Premine', v: '4,000,000,000', note: 'Allocated to the etcher at genesis' },
    ],
    guarantees: [],
  },
}

export const TOKEN_LIST = Object.values(TOKENS)

export function getToken(id: string | undefined): TokenInfo | null {
  if (!id) return null
  return TOKENS[id.toLowerCase()] ?? null
}
