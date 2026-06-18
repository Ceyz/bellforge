// B2 payment covenant (ordinal-lock primitive) — generalizes B1: pin output[0] to a committed
// payment, leave output[1] free for the spender. The covenant computes
// sha_outputs = SHA256(committedOut0 ‖ out1) in-script (out1 witness-supplied) and binds it to the
// real tx (CSFS + CHECKSIG). So output[0] MUST be the committed payment; output[1] is the spender's.
// Tx is forced to exactly 2 outputs. (docs/NATIVE_TOKEN.md §6.2 DEX sell-order.)
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, u64, varslice, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CHECKSIGFROMSTACK = 0xcc;

export const serializeOutput = (value, script) => Buffer.concat([u64(value), varslice(script)]);

// committedOut0 = serializeOutput(paymentValue, sellerScript). Witness (deepest→top):
// [c1=pre, c2=shaPrevouts, c3=shaAmounts, c4=shaScriptPubKeys, c5=shaSequences, out1, c7=mid,
//  c8=leafHash, c9=post, P, sig].
export function buildB2Script(committedOut0) {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]);
  return bells.script.compile([
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,                 // sig, P -> alt
    O.OP_CAT, O.OP_CAT,                               // c8‖c9, c7‖(c8c9)
    O.OP_SWAP,                                        // bring out1 (was 2nd) to top
    committedOut0, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,  // c6 = SHA256(committedOut0 ‖ out1)
    O.OP_SWAP, O.OP_CAT,                              // c6 ‖ (c7c8c9)
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, // prepend c5..c1 -> full message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,         // computed_sighash
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,             // P, sig
    ...CSFS_PUBKEY_SIG_PINS,                           // pin |P|==32, |sig|==64 (consensus; BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK,                        // stash sig copy
    O.OP_OVER, O.OP_TOALTSTACK,                       // stash P copy
    O.OP_ROT, O.OP_ROT,                              // [computed,P,sig] -> [sig,computed,P]
    OP_CHECKSIGFROMSTACK, O.OP_VERIFY,               // CSFS bind (computed sighash)
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,            // P, sig
    O.OP_SWAP, O.OP_CHECKSIG,                        // CHECKSIG bind (real sighash) -> 1
  ]);
}
