// P1e-1 — covenant SELF-REPLICATION (the anti-theft / anti-leak primitive for a real token note).
// A token note is a SPENDABLE UTXO locked by the token covenant; on transfer the covenant must force a
// new output locked by the SAME covenant scriptPubKey (else the tokens leak to an arbitrary address).
// The covenant does NOT know its own P2TR address at build time (circular), so it RECONSTRUCTS the
// shaScriptPubKeys component from a witness-supplied ownSPK: c4 = SHA256(varslice(ownSPK)). Because the
// CSFS+CHECKSIG binding forces the reconstructed sighash == the real one, c4 is forced to equal the REAL
// input scriptPubKey hash ⟹ ownSPK == the spent covenant's own SPK. The covenant then builds
// output[0] = tokenOut = value ‖ varslice(ownSPK) and binds it via sha_outputs ⟹ output[0] is locked by
// the SAME covenant. A transfer that sends the note to a different SPK breaks c4 or sha_outputs → reject.
// (SECURITY_PLAN §7 "TOKEN TOPOLOGY"; single-input only — multi-input needs all input SPKs in c4.)
//
// Witness deepest→top: [c1=pre, c2=shaPrevouts, c3=shaAmounts, c5=shaSequences, c7=mid, c8=leafHash,
//   c9=post, out1(free output bytes), out0Value(8B LE), ownSPK(34B), P, sig].  (c4 and c6 are COMPUTED.)
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const N = bells.script.number;
const OP_CSFS = 0xcc;

export function p1e1Ops() {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]);
  return [
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,            // sig, P -> alt ; top: ownSPK, out0Value, out1, c9..c1
    // --- reconstruct vs = varslice(ownSPK) and c4 = shaScriptPubKeys = SHA256(vs) ---
    O.OP_SIZE, N.encode(34), O.OP_EQUALVERIFY,   // |ownSPK| == 34 (P2TR) so the 0x22 length prefix is correct
    Buffer.from([0x22]), O.OP_SWAP, O.OP_CAT,    // vs = 0x22 ‖ ownSPK   (compactSize(34)=0x22)
    O.OP_DUP, O.OP_SHA256,                       // c4 = SHA256(vs)
    O.OP_TOALTSTACK,                             // c4 -> alt ; top: vs, out0Value, out1, ...
    // --- tokenOut = out0Value ‖ vs ; c6 = SHA256(tokenOut ‖ out1) ---
    // C1 FIX (audit 2026-06-13): pin |out0Value|==8 BEFORE the OP_CAT. Without it the binding only forces the
    // CONCATENATION out0Value‖0x22‖ownSPK‖out1==real outputs, so an attacker slides the 0x22‖ownSPK needle to any
    // byte offset (e.g. inside a 0-value OP_RETURN) and the note LEAKS. With |out0Value|==8 the needle is forced to
    // byte 8 = exactly the start of varslice(spk) in serialize(output[0]) → output[0] MUST be value‖0x22‖ownSPK.
    O.OP_SWAP, O.OP_SIZE, N.encode(8), O.OP_EQUALVERIFY, O.OP_SWAP, // |out0Value| == 8
    O.OP_CAT,                                    // out0Value ‖ vs = tokenOut (output[0] = value‖varslice(ownSPK))
    O.OP_SWAP, O.OP_CAT,                         // tokenOut ‖ out1
    O.OP_SHA256,                                 // c6 = sha_outputs ; top: c6, c9, c8, c7, c5, c3, c2, c1
    // --- assemble message = c1‖c2‖c3‖c4‖c5‖c6‖c7‖c8‖c9 (c4 on alt, c6 just computed) ---
    O.OP_TOALTSTACK,                             // c6 -> alt ; top: c9, c8, c7, c5, c3, c2, c1
    O.OP_CAT, O.OP_CAT,                          // c7 ‖ c8 ‖ c9
    O.OP_FROMALTSTACK,                           // c6
    O.OP_SWAP, O.OP_CAT,                         // c6 ‖ (c7c8c9)
    O.OP_CAT,                                    // c5 ‖ (c6..c9)
    O.OP_FROMALTSTACK,                           // c4
    O.OP_SWAP, O.OP_CAT,                         // c4 ‖ (c5..c9)
    O.OP_CAT, O.OP_CAT, O.OP_CAT,                // prepend c3, c2, c1 -> message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,    // computed_sighash = SHA256(prefix ‖ message)
    // --- bind computed==real (CSFS over computed + CHECKSIG over real, same sig+P) ---
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,        // P, sig  (alt now back to [sig,P]) -> [cs, P, sig]
    ...CSFS_PUBKEY_SIG_PINS,                      // pin |P|==32, |sig|==64 at CONSENSUS (BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK,
    O.OP_OVER, O.OP_TOALTSTACK,
    O.OP_ROT, O.OP_ROT,
    OP_CSFS, O.OP_VERIFY,                         // CSFS over computed_sighash (forces c4=ownSPK + c6=outputs real)
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,
    O.OP_SWAP, O.OP_CHECKSIG,                     // CHECKSIG over the REAL sighash
  ];
}

export const buildP1e1Script = () => bells.script.compile(p1e1Ops());
