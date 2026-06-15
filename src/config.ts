/** The permanent on-chain game (Bellbound), inscribed on Bells testnet and served
    from the Nintondo content host. The wallet does not inject on the content host,
    so the canonical play URL is bridged (see pokebells/play-bridge.html).
    TODO: set the exact root inscription — `<host>/content/<root-id>i0`. */
export const GAME_URL = 'https://bells-testnet-content.nintondo.io'

export const DOCS_URL = '#'
export const GITHUB_URL = '#'
/** Block-explorer link a skeptic can open to confirm the anti-inflation covenant. */
export const PROOF_URL = '#'

/** Resolve a public/ asset URL respecting Vite's base, so refs work both at the
    custom apex domain (bellforge.app) and the github.io/bellforge/ preview. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`
