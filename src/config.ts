/** The permanent on-chain game (Bellbound) — its root inscription, served from the
    Nintondo content host. This is where the game actually plays. */
export const GAME_URL =
  'https://bells-testnet-content.nintondo.io/content/b62a7d5c904a7ae74066e3156d655c31679e9e2b86bce250740be2be2019a12fi0'

export const DOCS_URL = '#'
export const GITHUB_URL = '#'
/** Block-explorer link a skeptic can open to confirm the anti-inflation covenant. */
export const PROOF_URL = '#'

/** Resolve a public/ asset URL respecting Vite's base, so refs work both at the
    custom apex domain (bellforge.app) and the github.io/bellforge/ preview. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

/** Electrs (esplora-compatible) bases for reading on-chain balances. */
export const ELECTRS = {
  mainnet: 'https://api.nintondo.io',
  testnet: 'https://bells-testnet-api.nintondo.io',
}
