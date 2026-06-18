// P3 v1 — CLOSED ONE-SHOT GENESIS MINTER (operator-set supply, trustless after). docs/MINTER_DESIGN.md.
// A per-token covenant UTXO whose spend IS the mint. It (1) requires the pre-chosen genesis input G consumed
// (token_id=G; multi-input sha_prevouts=SHA256(concat ALL outpoints) so the vin set is frozen to [minter@M, G]),
// (2) reconstructs sha_outputs from a FULLY-ENUMERATED, position+length-pinned output vector built from LEAF
// CONSTANTS (token note + paired stateOut + the exact fee) with NO free tail (only `change` is free, appended last),
// (3) binds it to the real tx via CSFS+CHECKSIG. Cap + fee are enforced BY CONSTRUCTION (byte-equality of constants,
// no witness number, no arithmetic) — this is why over-cap / fee-bypass / mint-from-nothing all close (the C1/H2
// free-tail bug class is avoided). One-shot: the minter is consumed + produces NO minter output; G spent once
// (Bitcoin no-double-spend) gives anti-double-mint even if the minter address is re-funded.
//
// Witness deepest->top: [ sig, P, c1=pre, c3=shaAmounts, c4=shaScriptPubKeys, c5=shaSequences, c7=mid, c8=leafHash,
//   c9=post, changeValue(8B), changeSPK(34B), M(36B = the minter's own spent outpoint) ]
//   (c2=shaPrevouts COMPUTED from M‖G; c6=shaOutputs COMPUTED from leaf constants + change.)
import * as bells from 'belcoinjs-lib';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const N = bells.script.number;
const OP_CSFS = 0xcc;

// tokenId = G (36B). tokenOut0/stateOut0/feeOut = the FROZEN leaf-constant outputs (43B / 43B / value‖varslice(spk)).
// changeSpkLen: the pinned byte length of the (canary) change scriptPubKey (P2TR = 34 → varint 0x22).
export function p3MinterOps({ tokenId, tokenOut0, stateOut0, feeOut, changeSpkLen = 34 }) {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]);
  return [
    // ===== STAGE A: stash sig,P ; c2 = SHA256(M ‖ G). The binding forces sha_prevouts==SHA256(M‖G) ⟹ vin=[M,G] EXACTLY
    //   (vinCount frozen = 2, vin[1]=G a leaf const) ⟹ G is required + the prevouts set has no free tail. =====
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,            // sig, P -> alt ; top: M, changeSPK, changeValue, c9..c1
    O.OP_SIZE, N.encode(36), O.OP_EQUALVERIFY,   // |M| == 36
    tokenId, O.OP_CAT,                           // M ‖ G   (G = token_id, leaf const)
    O.OP_SHA256,                                 // c2 = shaPrevouts = SHA256(M‖G)
    O.OP_TOALTSTACK,                             // c2 -> alt ; top: changeSPK, changeValue, c9..c1

    // ===== STAGE B: c6 = SHA256(tokenOut0 ‖ stateOut0 ‖ feeOut ‖ changeOut) — fully enumerated, count frozen, no free tail =====
    O.OP_SIZE, N.encode(changeSpkLen), O.OP_EQUALVERIFY,        // pin |changeSPK| (canary P2TR=34)
    Buffer.from([changeSpkLen]), O.OP_SWAP, O.OP_CAT,           // varslice(changeSPK) = len ‖ changeSPK  (len < 0xfd)
    O.OP_SWAP, O.OP_SIZE, N.encode(8), O.OP_EQUALVERIFY, O.OP_SWAP, // pin |changeValue| == 8 (C1 lesson)
    O.OP_CAT,                                    // changeValue ‖ varslice(changeSPK) = changeOut
    feeOut, O.OP_SWAP, O.OP_CAT,                 // feeOut ‖ changeOut          (fee reconstructed from CONSTANTS, not witness)
    stateOut0, O.OP_SWAP, O.OP_CAT,              // stateOut0 ‖ (feeOut‖changeOut)
    tokenOut0, O.OP_SWAP, O.OP_CAT,              // tokenOut0 ‖ ... = the WHOLE output vector (exactly 4 outputs)
    O.OP_SHA256,                                 // c6 = shaOutputs

    // ===== STAGE C: message = c1‖c2‖c3‖c4‖c5‖c6‖c7‖c8‖c9 (c2 + c6 computed; the rest witness) =====
    O.OP_TOALTSTACK,                             // c6 -> alt ; top: c9, c8, c7, c5, c4, c3, c1
    O.OP_CAT, O.OP_CAT,                          // c7 ‖ c8 ‖ c9
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,      // c6 ‖ (c7c8c9)
    O.OP_CAT, O.OP_CAT, O.OP_CAT,                // prepend c5, c4, c3
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,      // c2 ‖ (c3..c9)
    O.OP_CAT,                                    // c1 ‖ (c2..c9) = message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,    // computed_sighash = SHA256(prefix ‖ message)

    // ===== STAGE D: bind computed==real (CSFS over computed + CHECKSIG over real, same sig+P) =====
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,        // P, sig -> [cs, P, sig]
    ...CSFS_PUBKEY_SIG_PINS,                      // pin |P|==32, |sig|==64 (consensus; SIGHASH_DEFAULT only)
    O.OP_DUP, O.OP_TOALTSTACK,
    O.OP_OVER, O.OP_TOALTSTACK,
    O.OP_ROT, O.OP_ROT,
    OP_CSFS, O.OP_VERIFY,                         // CSFS over computed (forces c2=G-bound prevouts + c6=frozen outputs)
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,
    O.OP_SWAP, O.OP_CHECKSIG,                     // CHECKSIG over the REAL sighash
  ];
}

export const buildP3MinterScript = (consts) => bells.script.compile(p3MinterOps(consts));
