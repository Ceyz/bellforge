// B4 conservation guard — enforces Σ output token-amounts == committed total T (OP_ADD, no multiply),
// with the amounts BOUND to the real tx outputs via the B2 introspection. Two committed recipients;
// the spender chooses the split (a1, a2) as long as a1 + a2 == T. (docs/NATIVE_TOKEN.md §2/§4.)
//
// Prototype model: token amount == the output's sat value (< 2^31 so it fits OP_ADD as a 4-byte
// CScriptNum). A production token carries uint64 amounts in a trailing OP_RETURN (int2ByteString) and
// reads INPUT amounts via backtrace + an indexer verifyGuardTokenAmount — same summing mechanic, more
// plumbing. Here we prove the on-chain summing + binding (the genuinely new capability).
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, varslice, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CHECKSIGFROMSTACK = 0xcc;
const ZERO4 = Buffer.alloc(4); // high 4 bytes of the 8-byte value (amount < 2^32)

// committedRest_i = varslice(ownerScript_i) — the output bytes AFTER the 8-byte value.
// Tbuf = bells.script.number.encode(T) — the committed total (minimal CScriptNum).
// Witness (deepest→top): [c1=pre, c2=shaPrevouts, c3=shaAmounts, c4=shaScriptPubKeys,
//   c5=shaSequences, c7=mid, c8=leafHash, c9=post, a1(4B LE), a2(4B LE), P, sig].
export function buildB4Script(committedRest0, committedRest1, Tbuf) {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]);
  return bells.script.compile([
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,            // sig, P -> alt
    // out1 = a2 ‖ ZERO4 ‖ committedRest1 (stash a2 for the sum)
    O.OP_DUP, O.OP_TOALTSTACK,                   // a2 copy -> alt
    ZERO4, O.OP_CAT, committedRest1, O.OP_CAT,   // out1
    // out0 = a1 ‖ ZERO4 ‖ committedRest0 (stash a1)
    O.OP_SWAP,                                    // a1 to top
    O.OP_DUP, O.OP_TOALTSTACK,                    // a1 copy -> alt
    ZERO4, O.OP_CAT, committedRest0, O.OP_CAT,    // out0
    O.OP_SWAP, O.OP_CAT, O.OP_SHA256,            // c6 = SHA256(out0 ‖ out1)
    // conservation: a1 + a2 == T
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,        // a1, a2
    O.OP_ADD, Tbuf, O.OP_EQUALVERIFY,            // a1 + a2 == T
    // build the sighash message from [c1..c5, c7, c8, c9, c6]
    O.OP_TOALTSTACK,                             // c6 -> alt
    O.OP_CAT, O.OP_CAT,                          // c7‖c8‖c9
    O.OP_FROMALTSTACK,                           // c6
    O.OP_SWAP, O.OP_CAT,                         // c6 ‖ (c7c8c9)
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, // prepend c5..c1 -> message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,    // computed_sighash
    // bind to the real tx (CSFS over computed + CHECKSIG over real, same sig+P)
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,        // P, sig
    ...CSFS_PUBKEY_SIG_PINS,                      // pin |P|==32, |sig|==64 (consensus; BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK,
    O.OP_OVER, O.OP_TOALTSTACK,
    O.OP_ROT, O.OP_ROT,
    OP_CHECKSIGFROMSTACK, O.OP_VERIFY,
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,
    O.OP_SWAP, O.OP_CHECKSIG,
  ]);
}

export const committedRest = (ownerScript) => varslice(ownerScript);
