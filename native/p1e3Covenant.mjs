// P1e-3 — the N9 fund-safe TRANSFER leaf (docs/N9_VERIFIER_SPEC.md). ONE tapscript leaf welding:
//   conservation (P1d) + self-replication (P1e-1) + owner-auth (P2-2) + N9 2-level lineage (OP_IF genesis/continuation).
//
// ✅ COMPLETE + CONSENSUS-PROVEN (2026-06-14) — the 905B welded leaf passes 43/43 scriptsim + regtest 5/5 at block
//   validation (p1e3_n9_regtest.test.mjs: real-Schnorr mint→T1→T2 GREEN + the BIP-342/over-amount/thief/forged-genesis/
//   multi-input REDs reject). Built in LAYERS via the scriptsim tight loop (the register allocation below = the solved crux):
//     LAYER 1: vout-boundary txP reconstruction + conservation + replication + owner-auth (no lineage). Core stack discipline.
//     LAYER 2: + continuation lineage (reconstruct txGP; hash256(txGP)‖00 == txP.vin0; out0==ownSPK; token_id==G).
//     LAYER 3: + genesis arm (OP_IF; template-pinned mint reconstruction: G/AMOUNT_0/OWNER_0/VALUE_0/feeOut consts).
//   ⚠ FROZEN for external audit: cut any mainnet genesis from a hash-pinned image of this leaf, never from a live edit.
//
// === DESIGN (locked) ===========================================================================================
// This TRANSFER tx is MONO-INPUT (vin0 = the spent note). COMPUTED on-stack: c2=SHA256(committedTxidP‖0x00000000)
// (note is out[0] of txP), c4=SHA256(0x22‖ownSPK) (replication), c6=SHA256(tokenOut‖stateOut_new‖changeOut) (3 outputs
// frozen, NO free tail). WITNESS: c1,c3,c5,c7,c8,c9 + sig,P + the txP pieces + the new-output pieces.
//
// txP (continuation) reconstruction, from p1e3Const.mjs (measured byte-exact):
//   txP = HDR_T ‖ vin0_outpoint(36) ‖ CONT_MID ‖ tokenOut0_P(=out0Val_P‖0x22‖ownSPK) ‖ stateOut_P(=FRAME‖SHA256(VTI‖amount_in‖owner_in)) ‖ tailP
//   hash256(txP) == committedTxidP   (committedTxidP = witness txidP, also drives c2)
//
// === REGISTER ALLOCATION (the crux — the alt LIFO timeline that AVOIDS the mis-ordered pulls) ===================
// Rule that makes it tractable (mirrors p1d): keep the alt stack SHALLOW and push computed sighash components LAST so
// the message-assembly pulls them in strict LIFO. Target alt during message assembly (bottom..top) = [owner_in, c2, c4, c6]
// → pull c6, c4, c2 (message), then owner_in (owner-auth). So compute order must PARK owner_in BEFORE c2/c4/c6.
// Therefore: do the txP backtrace FIRST (it parks amount_in then owner_in), THEN compute c2 (from committedTxidP),
// THEN c4 (from ownSPK), THEN c6 (conservation+replication), THEN assemble message, THEN bind+owner-auth.
//
// The ownSPK 3-uses (tokenOut0_P in backtrace, c4, new tokenOut in c6) are the only multi-copy value. Resolution:
// consume ownSPK in the backtrace stage to build tokenOut0_P, but DUP it twice first and TOALTSTACK the 2 spare copies
// DEEPEST (pushed before amount_in/owner_in) — pulled LAST, after the message has consumed c6/c4/c2 and after owner-auth.
// Wait: c4/new-tokenOut need ownSPK BEFORE owner_in is pulled. So instead keep the 2 spare ownSPK copies on MAIN, beneath
// the active txP reconstruction (which is consumed by the hash check), so they resurface for c4 + c6 without alt LIFO
// conflicts. Concretely the witness puts ownSPK copies adjacent to where the backtrace ends. FINAL ordering was NAILED
// in scriptsim (it reported `EQUALVERIFY @N: x!=y` / `underflow` pinpointing each mis-pull) + confirmed at consensus.
//
// ✅ RESOLVED 2026-06-14: OP_PICK/OP_ROLL (0x79/0x7a) are PROVEN to EXECUTE at CONSENSUS on this build
// (canaries/pick_roll.test.mjs: a wrong-compare negative leaf is REJECTED → they truly run, NOT OP_SUCCESSx). So the
// alt-LIFO dance above is OBSOLETE — for LAYER 1+ keep the long-lived values (ownSPK, committedTxidP/its hash,
// amount_in, owner_in) at known stack depths and OP_PICK a COPY to the top on each use (consumed there; original stays
// put), OP_ROLL the final use. Far simpler + auditable. scriptsim now models both. The LAYER 0 kernel below stays as-is
// (it is already linear/clean); LAYER 1 epilogue (c2/c4/c6 + message + binding + owner-auth) uses OP_PICK.
//
// Witness deepest->top (LAYER 1 working layout — refine in scriptsim):
//   [ sig, P, c1, c3, c5, c7, c8, c9, changeSPK(34), changeValue(8), out_owner(20), out0Value(8),
//     tailP(var), tokenOut0val_P(8), vin0_outpoint(36), owner_in(20), amount_in(8), txidP(32), ownSPK(34) ]
//
// Reuse VERBATIM (proven byte-for-byte): p1eCovenant.mjs STAGE (c4 + c6 from ownSPK + the message assembly + the
// CSFS/CHECKSIG tail) and p1dCovenant.mjs STAGE 4a/4c (out_state from the proven amount + the OP_OVER/HASH160/owner_in
// owner-auth weld). The NEW work vs those is: the txP pre-reconstruction (HDR_T‖vin0_outpoint‖CONT_MID‖tokenOut0_P) and
// computing c2 on-stack (p1d/p1e took c2 as witness).
// ================================================================================================================
import * as bells from 'belcoinjs-lib';
import { CSFS_PUBKEY_SIG_PINS, u64 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { HDR_T, HDR_G, CONT_MID, genMid, FRAME, vti, PREFIX, VOUT0_LE, LOCKTIME0 } from './p1e3Const.mjs';

const O = bells.opcodes;
const N = bells.script.number;
const S = bells.crypto.sha256;
const OP_CSFS = 0xcc;
const B = (...bytes) => Buffer.from(bytes);
export const sizePin = (n) => [O.OP_SIZE, N.encode(n), O.OP_EQUALVERIFY];

// ================================================================================================================
// LAYER 0 (scriptsim-GREEN, no node needed) — the NEW N9 primitive: vout-boundary txP reconstruction.
// Proves the spent note's amount_in/owner_in by REBUILDING the whole parent tx from PINNED sub-pieces (exposing
// vin0_outpoint, unlike p1d's opaque `pre`) and checking hash256(txP) == committedTxidP. LINEAR (no alt-register crux —
// that only appears in the epilogue c2/c4/c6 + binding, layered on next). This is the byte-correctness foundation.
//   txP = HDR_T ‖ vin0_outpoint(36) ‖ CONT_MID ‖ tokenOut0_P(=val‖0x22‖ownSPK) ‖ stateOut_P(=FRAME‖SHA256(VTI‖amount_in‖owner_in)) ‖ tailP
// Witness deepest->top: [ committedTxidP(32), tailP(var), vin0_outpoint(36), tokenOut0val_P(8), ownSPK(34), owner_in(20), amount_in(8) ]
// Final stack: [1] iff the reconstruction hashes to committedTxidP.
export function p1e3ReconstructTxPOps({ tokenId }) {
  const VTI = vti(tokenId);
  return [
    // --- build stateOut_P from amount_in (top) + owner_in ---
    ...sizePin(8),                               // |amount_in| == 8
    VTI, O.OP_SWAP, O.OP_CAT,                    // VTI ‖ amount_in        [.., owner_in, VTI‖amount_in]
    O.OP_SWAP, ...sizePin(20),                   // |owner_in| == 20       [.., VTI‖amount_in, owner_in]
    O.OP_CAT,                                    // (VTI‖amount_in) ‖ owner_in = state_P(65)
    O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT,     // stateOut_P(43) = FRAME ‖ SHA256(state_P)
    O.OP_TOALTSTACK,                             // stateOut_P -> alt      ; alt:[stateOut_P]
    // --- build tokenOut0_P = tokenOut0val_P ‖ 0x22 ‖ ownSPK ---
    ...sizePin(34),                              // |ownSPK| == 34
    B(0x22), O.OP_SWAP, O.OP_CAT,                // 0x22 ‖ ownSPK          [.., tokenOut0val_P, 0x22‖ownSPK]
    O.OP_SWAP, ...sizePin(8),                    // |tokenOut0val_P| == 8  [.., 0x22‖ownSPK, tokenOut0val_P]
    O.OP_SWAP, O.OP_CAT,                         // tokenOut0val_P ‖ 0x22‖ownSPK = tokenOut0_P(43)
    // --- assemble txP = HDR_T ‖ vin0_outpoint ‖ CONT_MID ‖ tokenOut0_P ‖ stateOut_P ‖ tailP ---
    O.OP_SWAP, ...sizePin(36),                   // |vin0_outpoint| == 36  [.., tokenOut0_P, vin0_outpoint]
    HDR_T, O.OP_SWAP, O.OP_CAT,                  // HDR_T ‖ vin0_outpoint
    CONT_MID, O.OP_CAT,                          // ‖ CONT_MID
    O.OP_SWAP, O.OP_CAT,                         // ‖ tokenOut0_P
    O.OP_FROMALTSTACK, O.OP_CAT,                 // ‖ stateOut_P (from alt)
    O.OP_SWAP, O.OP_CAT,                         // ‖ tailP             [.., committedTxidP, txP]
    O.OP_SHA256, O.OP_SHA256,                    // hash256(txP)
    O.OP_EQUAL,                                  // == committedTxidP   -> [1] on match
  ];
}
export const buildP1e3ReconstructScript = (consts) => bells.script.compile(p1e3ReconstructTxPOps(consts));

// ================================================================================================================
// LAYER 2 (scriptsim unit) — CONTINUATION LINEAGE: prove the grandparent txGP. Same vout-boundary reconstruction shape
// as the kernel, but: (a) tokenOut0_GP is built from ownSPK -> forces txGP.output[0].scriptPubKey == ownSPK (continuation
// = the grandparent was a note of THIS covenant); (b) stateOut_GP is built with VTI=0x01‖G -> forces txGP's note
// token_id == G (no cross-token graft); (c) the final check is hash256(txGP) ‖ 0x00000000 == vin0_outpoint (= txP.vin[0]
// outpoint, vout pinned 0 by R1). Induction: txGP.out0 spent in txP means the covenant already ran on it when txP mined.
// Witness deepest->top: [ vin0_outpoint(36), tailGP, vinGP_outpoint(36), valGP(8), ownSPK(34), ownerGP(20), amtGP(8) ]
// Final stack: [1] iff hash256(txGP)‖00 == vin0_outpoint AND txGP.out0==ownSPK AND txGP token_id==G.
export function p1e3TxGPLineageOps({ tokenId }) {
  const VTI = vti(tokenId);
  return [
    // stateOut_GP = FRAME ‖ SHA256(VTI ‖ amtGP ‖ ownerGP)   (amtGP top, ownerGP next)
    ...sizePin(8), VTI, O.OP_SWAP, O.OP_CAT,
    O.OP_SWAP, ...sizePin(20), O.OP_CAT,
    O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK,
    // tokenOut0_GP = valGP ‖ 0x22 ‖ ownSPK   (ownSPK top, valGP next)
    ...sizePin(34), B(0x22), O.OP_SWAP, O.OP_CAT,
    O.OP_SWAP, ...sizePin(8), O.OP_SWAP, O.OP_CAT,
    // assemble txGP = HDR_T ‖ vinGP_outpoint ‖ CONT_MID ‖ tokenOut0_GP ‖ stateOut_GP ‖ tailGP
    O.OP_SWAP, ...sizePin(36),
    HDR_T, O.OP_SWAP, O.OP_CAT, CONT_MID, O.OP_CAT,
    O.OP_SWAP, O.OP_CAT,
    O.OP_FROMALTSTACK, O.OP_CAT,
    O.OP_SWAP, O.OP_CAT,
    O.OP_SHA256, O.OP_SHA256,                          // hash256(txGP)
    Buffer.from(VOUT0_LE), O.OP_CAT,                   // ‖ 0x00000000
    O.OP_EQUAL,                                        // == vin0_outpoint -> [1]
  ];
}
export const buildP1e3TxGPLineageScript = (consts) => bells.script.compile(p1e3TxGPLineageOps(consts));

// ================================================================================================================
// EPILOGUE (testable in isolation; registers passed directly as witness "as if proven" — the reconstruction feeds
// them in the full leaf). Mono-input transfer: computes c2 (from committedTxidP), c4 (from ownSPK), c6 (conservation
// + replication, 3 outputs FROZEN, no free tail), assembles the 211-byte message, binds CSFS(computed)+CHECKSIG(real),
// and welds owner-auth (hash160(P)==owner_in). Consume-in-order so alt reaches [owner_in, c2, c4, c6] at message time
// (owner_in deepest → pulled last for owner-auth; c6 top → pulled first). The S6 binding tail is p1d/p2d VERBATIM.
// Witness deepest->top:
//   [ sig, P, c1, c3, c5, c7, c8, c9, changeSPK(34), changeValue(8), out_owner(20), amount_in(8), out0Value(8),
//     ownSPK(34), committedTxidP(32), owner_in(20) ]   (c2,c4,c6 COMPUTED)
export function p1e3EpilogueOps({ tokenId }) {
  const VTI = vti(tokenId);
  return [
    // S0: owner_in -> alt (deepest; owner-auth at S6)
    ...sizePin(20), O.OP_TOALTSTACK,                              // alt:[owner_in]
    // S1: c2 = SHA256(committedTxidP ‖ 0x00000000) -> alt   (single-input shaPrevouts; note pinned at vout 0)
    ...sizePin(32), Buffer.from(VOUT0_LE), O.OP_CAT, O.OP_SHA256, O.OP_TOALTSTACK,  // alt:[owner_in, c2]
    // S2: vs = 0x22 ‖ ownSPK ; c4 = SHA256(vs) -> alt ; keep vs on main
    ...sizePin(34), B(0x22), O.OP_SWAP, O.OP_CAT,                 // vs
    O.OP_DUP, O.OP_SHA256, O.OP_TOALTSTACK,                       // c4 -> alt ; alt:[owner_in,c2,c4] ; main top = vs
    // S3: tokenOut = out0Value ‖ vs -> alt   ; main: [.., out0Value, vs]
    O.OP_SWAP, ...sizePin(8), O.OP_SWAP, O.OP_CAT,                // |out0Value|==8 (C1) ; out0Value‖vs = tokenOut
    O.OP_TOALTSTACK,                                              // alt:[owner_in,c2,c4,tokenOut]
    // S4: stateOut_new = FRAME ‖ SHA256(VTI ‖ amount_in ‖ out_owner)   ; main top = amount_in, then out_owner
    ...sizePin(8), O.OP_DUP, Buffer.alloc(8, 0), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY, // |amount_in|==8 ; reject zero
    VTI, O.OP_SWAP, O.OP_CAT,                                     // VTI ‖ amount_in
    O.OP_SWAP, ...sizePin(20), O.OP_CAT,                          // |out_owner|==20 ; (VTI‖amount_in)‖out_owner = state_new
    O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT,                      // stateOut_new(43)
    O.OP_TOALTSTACK,                                              // alt:[owner_in,c2,c4,tokenOut,stateOut_new]
    // changeOut = changeValue ‖ (0x22 ‖ changeSPK)   ; main top = changeValue, then changeSPK
    ...sizePin(8),                                               // |changeValue|==8
    O.OP_SWAP, ...sizePin(34),                                   // |changeSPK|==34
    B(0x22), O.OP_SWAP, O.OP_CAT,                                 // 0x22 ‖ changeSPK = varslice
    O.OP_CAT,                                                     // changeValue ‖ varslice = changeOut
    // c6 = SHA256(tokenOut ‖ stateOut_new ‖ changeOut)
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                       // stateOut_new ‖ changeOut
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                       // tokenOut ‖ (stateOut_new‖changeOut)
    O.OP_SHA256, O.OP_TOALTSTACK,                                 // c6 -> alt ; alt:[owner_in,c2,c4,c6]
    // S5: message = c1‖c2‖c3‖c4‖c5‖c6‖c7‖c8‖c9 ; main top = c9,c8,c7,c5,c3,c1, then P, sig
    O.OP_CAT, O.OP_CAT,                                           // c7‖c8‖c9
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                       // c6‖(c7c8c9)
    O.OP_CAT,                                                     // c5‖(c6..c9)
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                       // c4‖(c5..c9)
    O.OP_CAT,                                                     // c3‖(c4..c9)
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                       // c2‖(c3..c9)
    O.OP_CAT,                                                     // c1‖(c2..c9) = message
    PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,                     // computed_sighash ; main: [sig, P, cs]
    // S6: bind + owner-auth (p1d/p2d STAGE 4c VERBATIM) ; alt:[owner_in]
    O.OP_SWAP, O.OP_ROT,                                          // -> [.., cs, P, sig] (sig top)
    ...CSFS_PUBKEY_SIG_PINS,                                      // |sig|==64, |P|==32
    O.OP_OVER, O.OP_HASH160, O.OP_FROMALTSTACK, O.OP_EQUALVERIFY, // hash160(P) == owner_in (owner-auth)
    O.OP_DUP, O.OP_TOALTSTACK, O.OP_OVER, O.OP_TOALTSTACK,        // stash sig, P
    O.OP_ROT, O.OP_ROT,                                           // [sig, cs, P]
    OP_CSFS, O.OP_VERIFY,                                         // CSFS over computed
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CHECKSIG, // CHECKSIG over real
  ];
}
export const buildP1e3EpilogueScript = (consts) => bells.script.compile(p1e3EpilogueOps(consts));

// ================================================================================================================
// LAYER 1 (FULL) — reconstruction ⊕ epilogue. The reconstruction PROVES amount_in/owner_in/committedTxidP via the
// vout-boundary txP rebuild, OP_PICKing the 4 shared registers (originals untouched) so the stack is left in EXACTLY
// the epilogue witness layout; the epilogue then runs VERBATIM. No lineage yet (LAYER 2/3); still forgeable by
// AUTHORING the parent — that hole is closed by the txGP/genesis lineage next.
//
// OP_PICK audit convention (GPT round-9): the depth math is confined to PHASE 1 where the original witness (idx 0..18)
// is INTACT (only PICK copies + intermediates pushed on top), so `n = depth-1-absIndex`. Each comment notes the absIndex.
//
// FULL witness deepest->top (idx):
//   [ sig(0),P(1),c1(2),c3(3),c5(4),c7(5),c8(6),c9(7), changeSPK(8),changeValue(9),out_owner(10),amount_in(11),
//     out0Value(12),ownSPK(13),committedTxidP(14),owner_in(15), tailP(16),vin0_outpoint(17),tokenOut0val_P(18) ]
//   (idx 0..15 = the epilogue layout; 16..18 = txP pieces consumed by the reconstruction; c2,c4,c6 COMPUTED.)
// The txP reconstruction (PHASE 1+2) alone — PROVES amount_in/owner_in/committedTxidP and LEAVES the epilogue layout
// (idx 0..15). Used directly by the OP_IF continuation arm (which prepends the txGP lineage), and wrapped by p1e3Ops.
export function p1e3TxPReconstructOps({ tokenId }) {
  const VTI = vti(tokenId);
  return [
    // PHASE 1: PICK registers, park committedTxidP, stateOut_P, vs on alt (pull order vs, stateOut_P, committedTxidP)
    N.encode(4), O.OP_PICK, ...sizePin(32), O.OP_TOALTSTACK,            // absIdx 14: committedTxidP -> alt
    N.encode(7), O.OP_PICK, ...sizePin(8), VTI, O.OP_SWAP, O.OP_CAT,    // absIdx 11: amount_in ; VTI ‖ amount_in
    N.encode(4), O.OP_PICK, ...sizePin(20), O.OP_CAT,                   // absIdx 15: owner_in ; (VTI‖amount_in) ‖ owner_in = state_P(65)
    O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK,           // stateOut_P(43) -> alt
    N.encode(5), O.OP_PICK, ...sizePin(34), B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK,  // absIdx 13: ownSPK ; vs -> alt
    // PHASE 2: consume txP pieces (18,17,16), assemble txP, hash256 == committedTxidP
    ...sizePin(8), O.OP_FROMALTSTACK, O.OP_CAT,                         // tokenOut0val_P(18) ‖ vs = tokenOut0_P(43)
    O.OP_SWAP, ...sizePin(36),                                         // vin0_outpoint(17)
    HDR_T, O.OP_SWAP, O.OP_CAT, CONT_MID, O.OP_CAT,                     // HDR_T ‖ vin0_outpoint ‖ CONT_MID
    O.OP_SWAP, O.OP_CAT,                                               // ‖ tokenOut0_P
    O.OP_FROMALTSTACK, O.OP_CAT,                                       // ‖ stateOut_P (alt)
    O.OP_SWAP, O.OP_CAT,                                               // ‖ tailP(16)
    O.OP_SHA256, O.OP_SHA256,                                          // hash256(txP)
    O.OP_FROMALTSTACK, O.OP_EQUALVERIFY,                               // == committedTxidP ; stack now = epilogue layout (idx 0..15)
  ];
}
export function p1e3Ops({ tokenId }) {
  return [...p1e3TxPReconstructOps({ tokenId }), ...p1e3EpilogueOps({ tokenId })];
}
export const buildP1e3Script = (consts) => bells.script.compile(p1e3Ops(consts));

// ================================================================================================================
// CONTINUATION ARM (LAYER 1 + LAYER 2) — the fund-safe transfer of a NON-genesis note. A Layer-2 PREFIX reconstructs
// the grandparent txGP and proves `hash256(txGP)‖00 == vin0_outpoint` (+ txGP.out0==ownSPK + token_id==G), CONSUMING the
// txGP pieces and OP_PICKing ownSPK + vin0_outpoint so it leaves idx 0..18 untouched; then `p1e3Ops` (the proven full
// Layer 1) runs verbatim. This closes the N9 hole for continuation notes: an authored parent can't pass because its
// vin[0] must point at a real covenant note (txGP) of token G, which itself was covenant-validated when spent in txP.
//
// CONTINUATION witness deepest->top:
//   [ <idx 0..18 = the p1e3Ops witness>, tailGP(19), vinGP_outpoint(20), valGP(21), ownerGP(22), amtGP(23) ]
// LAYER-2 PREFIX — prove the grandparent txGP, PICK ownSPK(13) + vin0_outpoint(17), leave idx 0..18.
// ⚠ CRITICAL FIX (audit 2026-06-14 lineage-freeze): the grandparent of a note ONE HOP past genesis is the 2-INPUT MINT,
// not a mono-input transfer. So this is a nested OP_IF(gpSelector): MINT-shape (reuse the genesis template, gpSelector=0x01)
// OR TRANSFER-shape (mono-input, gpSelector=empty). Each branch self-enforces hash256(txGP)‖00==vin0_outpoint (selector
// sound). Without this every token freezes after exactly one transfer. The mint-gp branch checks identity + out0==ownSPK +
// token_id==G ONLY (the note's amount/owner come from the PARENT via Layer 1).
export function p1e3ContinuationPrefixOps({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34 }) {
  const VTI = vti(tokenId);
  const stateOut0 = Buffer.concat([FRAME, S(encodeState({ tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]); // const
  return [
    O.OP_IF,
    // ===== grandparent = the 2-input MINT (gpSelector=0x01). witness (after pop): [idx 0..18, changeSPK_gp(19), changeValue_gp(20), M_gp(21)] depth 22 =====
    ...sizePin(36),                                                   // |M_gp| == 36
    HDR_G, O.OP_SWAP, O.OP_CAT,                                       // HDR_G ‖ M_gp
    genMid(tokenId), O.OP_CAT,                                        // ‖ genMid(G)
    u64(VALUE_0), B(0x22), O.OP_CAT,                                  // VALUE_0 ‖ 0x22
    N.encode(9), O.OP_PICK, ...sizePin(34), O.OP_CAT,                 // absIdx 13: ownSPK (depth 23 -> n=9) ; tokenNote0
    O.OP_CAT,                                                         // acc ‖ tokenNote0
    stateOut0, O.OP_CAT,                                              // ‖ stateOut0 (const, binds token_id=G)
    feeOut, O.OP_CAT,                                                 // ‖ feeOut (const)
    O.OP_TOALTSTACK,                                                  // prefix_gp -> alt
    ...sizePin(8),                                                    // |changeValue_gp| == 8
    O.OP_SWAP, ...sizePin(changeSpkLen),                             // |changeSPK_gp| == 34
    Buffer.from([changeSpkLen]), O.OP_SWAP, O.OP_CAT,                 // varslice ‖ changeSPK_gp
    O.OP_CAT,                                                         // changeValue_gp ‖ varslice = changeOut_gp
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,                           // prefix_gp ‖ changeOut_gp
    LOCKTIME0, O.OP_CAT,                                              // ‖ locktime = txGP_mint
    O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT,        // hash256(txGP_mint) ‖ 0x00000000
    N.encode(2), O.OP_PICK, O.OP_EQUALVERIFY,                         // absIdx 17: vin0_outpoint (depth 20 -> n=2) == it
    O.OP_ELSE,
    // ===== grandparent = a mono-input TRANSFER (gpSelector=empty). witness (after pop): [idx 0..18, tailGP(19), vinGP(20), valGP(21), ownerGP(22), amtGP(23)] depth 24 =====
    ...sizePin(8), VTI, O.OP_SWAP, O.OP_CAT,                          // stateOut_GP = FRAME ‖ SHA256(VTI ‖ amtGP ‖ ownerGP)
    O.OP_SWAP, ...sizePin(20), O.OP_CAT,
    O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK,
    ...sizePin(8),                                                    // |valGP| == 8
    N.encode(8), O.OP_PICK, ...sizePin(34),                           // absIdx 13: ownSPK (depth 22 -> n=8)
    B(0x22), O.OP_SWAP, O.OP_CAT,
    O.OP_CAT,                                                         // valGP ‖ 0x22 ‖ ownSPK = tokenOut0_GP
    O.OP_SWAP, ...sizePin(36),
    HDR_T, O.OP_SWAP, O.OP_CAT, CONT_MID, O.OP_CAT,
    O.OP_SWAP, O.OP_CAT,
    O.OP_FROMALTSTACK, O.OP_CAT,
    O.OP_SWAP, O.OP_CAT,
    O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT,        // hash256(txGP) ‖ 0x00000000
    N.encode(2), O.OP_PICK, O.OP_EQUALVERIFY,                         // absIdx 17: vin0_outpoint (depth 20 -> n=2) == it
    O.OP_ENDIF,
  ];
}
// CONTINUATION arm WITHOUT the epilogue (leaves idx 0..15) — for the OP_IF leaf.
export function p1e3ContinuationReconstructOps(consts) {
  return [...p1e3ContinuationPrefixOps(consts), ...p1e3TxPReconstructOps({ tokenId: consts.tokenId })];
}
// Standalone CONTINUATION transfer (prefix + Layer 1 + epilogue).
export function p1e3ContinuationOps(consts) {
  return [...p1e3ContinuationPrefixOps(consts), ...p1e3Ops({ tokenId: consts.tokenId })];
}
export const buildP1e3ContinuationScript = (consts) => bells.script.compile(p1e3ContinuationOps(consts));

// ================================================================================================================
// LAYER 3 — GENESIS arm (template-pinned) + the OP_IF full leaf. The genesis arm reconstructs the spent note's parent as
// the 2-input mint tx from the FULL mint template (consts G/AMOUNT_0/OWNER_0/VALUE_0/feeOut; ownSPK reconstructed, NOT
// baked -> non-circular), proving the genesis note is bound to the EXACT capped+fee'd shape. It also verifies the witness
// amount_in==AMOUNT_0 and owner_in==OWNER_0 (so the epilogue's owner-auth forces the operator's key on the first transfer).
//   txP_genesis = HDR_G ‖ M(witness 36) ‖ genMid(G) ‖ tokenNote0(VALUE_0‖0x22‖ownSPK) ‖ stateOut0(const) ‖ feeOut(const)
//                 ‖ changeOut_gen(witness) ‖ LOCKTIME0
// GENESIS arm witness (after OP_IF pops the selector) deepest->top:
//   [ <idx 0..15 epilogue layout>, changeSPK_gen(16), changeValue_gen(17), M_outpoint(18) ]
export function p1e3GenesisReconstructOps({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34 }) {
  const stateOut0 = Buffer.concat([FRAME, S(encodeState({ tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]); // const
  return [
    // prefix_gen = HDR_G ‖ M ‖ genMid(G) ‖ tokenNote0 ‖ stateOut0 ‖ feeOut -> alt
    ...sizePin(36),                                   // |M_outpoint| == 36
    HDR_G, O.OP_SWAP, O.OP_CAT,                       // HDR_G ‖ M
    genMid(tokenId), O.OP_CAT,                        // ‖ genMid(G)
    u64(VALUE_0), B(0x22), O.OP_CAT,                  // VALUE_0 ‖ 0x22
    N.encode(6), O.OP_PICK, ...sizePin(34), O.OP_CAT, // absIdx 13: ownSPK (depth 20 -> n=6) ; ‖ ownSPK = tokenNote0
    O.OP_CAT,                                         // acc ‖ tokenNote0
    stateOut0, O.OP_CAT,                              // ‖ stateOut0 (const)
    feeOut, O.OP_CAT,                                 // ‖ feeOut (const)
    O.OP_TOALTSTACK,                                  // prefix_gen -> alt
    // changeOut_gen = changeValue_gen ‖ (0x22 ‖ changeSPK_gen)
    ...sizePin(8),                                    // |changeValue_gen| == 8
    O.OP_SWAP, ...sizePin(changeSpkLen),              // |changeSPK_gen| == 34
    Buffer.from([changeSpkLen]), O.OP_SWAP, O.OP_CAT, // varslice prefix ‖ changeSPK_gen
    O.OP_CAT,                                         // changeValue_gen ‖ varslice = changeOut_gen
    // txP_genesis = prefix_gen ‖ changeOut_gen ‖ LOCKTIME0 ; hash256 == committedTxidP
    O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT,           // prefix_gen ‖ changeOut_gen
    LOCKTIME0, O.OP_CAT,                              // ‖ locktime
    O.OP_SHA256, O.OP_SHA256,                         // hash256(txP_genesis)
    N.encode(2), O.OP_PICK, O.OP_EQUALVERIFY,         // absIdx 14: committedTxidP (depth 17 -> n=2) ; == it
    // the genesis note carries EXACTLY the operator-set (cap, owner): amount_in==AMOUNT_0, owner_in==OWNER_0
    N.encode(4), O.OP_PICK, u64(AMOUNT_0), O.OP_EQUALVERIFY, // absIdx 11: amount_in (depth 16 -> n=4) == AMOUNT_0
    O.OP_DUP, OWNER_0, O.OP_EQUALVERIFY,              // absIdx 15: owner_in (top) == OWNER_0
  ];
}

// FULL N9 LEAF — OP_IF(selector): genesis arm (template-pinned) OR continuation arm (txGP lineage); shared epilogue after.
// selector (top witness): 0x01 = genesis, empty = continuation (MINIMALIF). Both arms leave idx 0..15 for the epilogue.
export function p1e3FullOps({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34 }) {
  // M-01 (audit): v1 amount is INVARIANT (genesis AMOUNT_0 + inductive conservation), so the <2^63 bound is a BUILD-TIME
  // assert here rather than a runtime gate (a top-byte check on an 8B blob is non-trivial without OP_SUBSTR — Phase 2).
  if (typeof AMOUNT_0 !== 'bigint' || AMOUNT_0 < 0n || AMOUNT_0 >= (1n << 63n)) throw new Error(`AMOUNT_0 must be a bigint in [0, 2^63): ${AMOUNT_0}`);
  const consts = { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen };
  return [
    O.OP_IF,
    ...p1e3GenesisReconstructOps(consts),
    O.OP_ELSE,
    ...p1e3ContinuationReconstructOps(consts),
    O.OP_ENDIF,
    ...p1e3EpilogueOps({ tokenId }),
  ];
}
export const buildP1e3FullScript = (consts) => bells.script.compile(p1e3FullOps(consts));
