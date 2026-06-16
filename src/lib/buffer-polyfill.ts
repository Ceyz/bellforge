// Import this BEFORE anything that pulls in runelib / bitcoinjs-lib.
// runelib decodes runestones via bitcoinjs-lib's Transaction.fromHex, which reads
// the GLOBAL Buffer at runtime — absent in browsers, so every decode would throw.
import { Buffer } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
}
