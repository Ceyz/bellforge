/** The permanent on-chain game (Bellbound) — its root inscription, served from the
    Nintondo content host. This is where the game actually plays. */
export const GAME_URL =
  'https://bells-testnet-content.nintondo.io/content/b62a7d5c904a7ae74066e3156d655c31679e9e2b86bce250740be2be2019a12fi0'

export const DOCS_URL = '#'
export const GITHUB_URL = 'https://github.com/Ceyz/bellforge'

/** Bellscoin block explorer (Nintondo). */
export const EXPLORER = 'https://nintondo.io/bells/explorer'
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`
export const explorerTx = (t: string) => `${EXPLORER}/tx/${t}`
export const explorerBlock = (h: string | number) => `${EXPLORER}/block/${h}`

/** A live block on the Bellscoin chain — the on-chain reference a skeptic can open. */
export const PROOF_URL = explorerBlock('411732bcacf1d6eb0d58cb2b31ed460fe2244d8c598dc86ed94e9ea62716d5cc')

/** Resolve a public/ asset URL respecting Vite's base, so refs work both at the
    custom apex domain (bellforge.app) and the github.io/bellforge/ preview. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

/** Electrs (esplora-compatible) bases for reading on-chain balances. */
export const ELECTRS = {
  mainnet: 'https://api.nintondo.io',
  testnet: 'https://bells-testnet-api.nintondo.io',
}
