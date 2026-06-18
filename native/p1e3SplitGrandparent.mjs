// P2-5 LINEAGE v2 — Step 6b: the GRANDPARENT multi-shape prefix (closes mint-from-nothing). The composed leaf so far
// (splitFullLineageOps) proves amount_in/owner_in from the REAL parent txP (c2 pins committedTxidP to the real parent), but a
// note's spender could still AUTHOR txP as an arbitrary tx paying ownSPK. This prefix proves txP.vin0 spent a real COVENANT note:
// it reconstructs the grandparent txGP and verifies `hash256(txGP) ‖ 0x00000000 == txP.vin0_outpoint ∧ txGP.out0 == ownSPK ∧
// txGP token_id == G` — depth-2 induction (when txP was mined the covenant already ran on txGP.out0).
//
// FIRST consensus version: grandparent ∈ {GENESIS/2-input mint, TRANSFER-1→1/mono-input} — BOTH put the note txP spent at vout0,
// so this is BYTE-IDENTICAL to the consensus-proven N9 grandparent (p1e3Covenant.p1e3ContinuationPrefixOps), re-based onto the
// split-child leaf's witness layout. (The SPLIT-child grandparent shape — txGP itself a split, txP-input note @ vout 2j' — is
// DEFERRED; it needs the j'/M'' parametrization design.) Nested OP_IF(gpSelector): 0x01 = MINT (template-pinned, reuse the
// minter consts), empty = mono-TRANSFER. Each arm self-enforces hash256(txGP)‖00 == txP.vin0_outpoint (selector-sound).
//
// The txGP pieces sit ABOVE the splitFullLineageOps Wtotal witness + the selector on top; the prefix consumes them and the
// selector, leaving the Wtotal witness INTACT, then splitFullLineageOps runs VERBATIM. txP.vin0_outpoint is at abs 1 (kernel-bound
// to the real txP by hash256==committedTxidP), ownSPK at abs Wk+8 (c4-bound). Manual per-arm depth (the two arms differ in piece
// count) — exactly as N9. scriptsim-verified with real genesis-chain + transfer-chain spends.
import * as bells from 'belcoinjs-lib';
import { u64 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { HDR_T, HDR_G, CONT_MID, genMid, FRAME, vti, VOUT0_LE, LOCKTIME0 } from './p1e3Const.mjs';
import { HDR_S, splitMid } from './p1e3SplitConst.mjs';
import { encodeState as encState, encodeAmount as encAmt } from './wire.mjs';
import { splitFullLineageOps } from './p1e3SplitFullLineage.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);

// the same layout splitFullLineageOps uses (so the prefix's abs match the leaf's).
function layout(Mp, M, N) {
  const Wk = 3 + 3 * Mp;
  const childBase = Wk + 10 + 2 * M;
  const Wtotal = childBase + 2 * M * N + 2 * N;
  return { Wk, Wtotal, ownSpkAbs: Wk + 8, vin0Abs: 1 };
}

export function splitGrandparentPrefixOps(Mp, j, M, N, { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34 }) {
  if (!Buffer.isBuffer(feeOut)) throw new Error('feeOut must be a Buffer (the genesis fee output: value ‖ varslice(feeSPK))');
  const VTI = vti(tokenId);
  const stateOut0 = Buffer.concat([FRAME, S(encodeState({ tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]); // genesis const
  const { Wtotal, ownSpkAbs, vin0Abs } = layout(Mp, M, N);

  const ops = [];
  let depth = 0;                                              // set manually at each OP_IF arm
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const sizePin = (n) => e(O.OP_SIZE, enc(n), O.OP_EQUALVERIFY);

  ops.push(O.OP_IF);
  // ===== arm A — grandparent = the 2-input MINT (gpSelector=0x01). pieces (deepest→top): changeSPK_gp, changeValue_gp, M_gp =====
  depth = Wtotal + 3;
  sizePin(36);                                               // |M_gp| == 36 (M_gp top)
  e(HDR_G, O.OP_SWAP, O.OP_CAT);                             // HDR_G ‖ M_gp
  e(genMid(tokenId), O.OP_CAT);                             // ‖ genMid(G)  (G = vin1 outpoint, voutCount=04, baked)
  e(u64(VALUE_0), B(0x22), O.OP_CAT);                       // VALUE_0 ‖ 0x22
  pick(ownSpkAbs); sizePin(34); e(O.OP_CAT);                // ‖ ownSPK = tokenNote0 (VALUE_0‖0x22‖ownSPK)
  e(O.OP_CAT);                                              // acc ‖ tokenNote0
  e(stateOut0, O.OP_CAT);                                   // ‖ stateOut0 (const, binds token_id==G + AMOUNT_0/OWNER_0)
  e(feeOut, O.OP_CAT);                                      // ‖ feeOut (const)
  e(O.OP_TOALTSTACK);                                       // prefix_gp -> alt
  sizePin(8);                                               // |changeValue_gp| == 8
  e(O.OP_SWAP); sizePin(changeSpkLen);                      // |changeSPK_gp| == 34
  e(B(changeSpkLen), O.OP_SWAP, O.OP_CAT);                  // 0x22 ‖ changeSPK_gp
  e(O.OP_CAT);                                              // changeValue_gp ‖ varslice = changeOut_gp
  e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT);                // prefix_gp ‖ changeOut_gp
  e(Buffer.from(LOCKTIME0), O.OP_CAT);                      // ‖ locktime = txGP_mint
  e(O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT); // hash256(txGP_mint) ‖ 0x00000000
  pick(vin0Abs); e(O.OP_EQUALVERIFY);                       // == txP.vin0_outpoint
  ops.push(O.OP_ELSE);
  // ===== arm B — grandparent = a mono-input TRANSFER (gpSelector=empty). pieces: tailGP, vinGP, valGP, ownerGP, amtGP =====
  depth = Wtotal + 5;
  sizePin(8); e(VTI, O.OP_SWAP, O.OP_CAT);                  // amtGP top; VTI ‖ amtGP
  e(O.OP_SWAP); sizePin(20); e(O.OP_CAT);                   // ownerGP; (VTI‖amtGP) ‖ ownerGP = state_GP(65)
  e(O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // stateOut_GP(43) -> alt
  sizePin(8);                                               // |valGP| == 8
  pick(ownSpkAbs); sizePin(34);                             // ownSPK
  e(B(0x22), O.OP_SWAP, O.OP_CAT);                          // 0x22 ‖ ownSPK
  e(O.OP_CAT);                                              // valGP ‖ 0x22‖ownSPK = tokenOut0_GP
  e(O.OP_SWAP); sizePin(36);                                // vinGP_outpoint
  e(HDR_T, O.OP_SWAP, O.OP_CAT, CONT_MID, O.OP_CAT);        // HDR_T ‖ vinGP ‖ CONT_MID
  e(O.OP_SWAP, O.OP_CAT);                                   // ‖ tokenOut0_GP
  e(O.OP_FROMALTSTACK, O.OP_CAT);                           // ‖ stateOut_GP
  e(O.OP_SWAP, O.OP_CAT);                                   // ‖ tailGP = full txGP_transfer
  e(O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT); // hash256(txGP) ‖ 0x00000000
  pick(vin0Abs); e(O.OP_EQUALVERIFY);                       // == txP.vin0_outpoint
  ops.push(O.OP_ENDIF);
  return { ops };
}

// the FULL fund-safe split-child transfer leaf = grandparent prefix ⊕ splitFullLineageOps (depth-2 lineage closed).
export function splitFullLineageGrandparentOps(Mp, j, M, N, consts) {
  const { tokenId, changeSPK } = consts;
  return [...splitGrandparentPrefixOps(Mp, j, M, N, consts).ops, ...splitFullLineageOps(Mp, j, M, N, { tokenId, changeSPK }).ops];
}
export const buildSplitFullLineageGrandparentLeaf = (Mp, j, M, N, consts) => bells.script.compile(splitFullLineageGrandparentOps(Mp, j, M, N, consts));

// grandparent witness pieces (deepest→top) to APPEND above the splitFullLineageWitness. The MINT shape spent at gpVin0 + G;
// the TRANSFER shape spent gpVin0. Returns { txGP (legacy bytes, for committedTxidGP), pieces (incl. selector on top) }.
export function genesisGrandparent({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeSPKgp, changeValueGp }) {
  const stateOut0 = Buffer.concat([FRAME, S(encodeState({ tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const tokenNote0 = Buffer.concat([u64(VALUE_0), B(0x22), ownSPK]);
  const changeOutGp = Buffer.concat([u64(changeValueGp), B(0x22), changeSPKgp]);
  const txGP = Buffer.concat([HDR_G, mintOutpoint, genMid(tokenId), tokenNote0, stateOut0, feeOut, changeOutGp, Buffer.from(LOCKTIME0)]);
  return { txGP, pieces: [changeSPKgp, u64(changeValueGp), mintOutpoint, B(0x01)] };
}
export function transferGrandparent({ tokenId, ownSPK, gpVin0Outpoint, valGP, ownerGP, amtGP, tailGP }) {
  const tokenOut0GP = Buffer.concat([u64(valGP), B(0x22), ownSPK]);
  const stateOutGP = Buffer.concat([FRAME, S(encodeState({ tokenId, amount: BigInt(amtGP), owner: ownerGP }))]);
  const txGP = Buffer.concat([HDR_T, gpVin0Outpoint, CONT_MID, tokenOut0GP, stateOutGP, tailGP]);
  return { txGP, pieces: [tailGP, gpVin0Outpoint, u64(valGP), ownerGP, u64(amtGP), Buffer.alloc(0)] };
}

// ====================================================================================================================
// SPLIT-CHILD grandparent arm (Step 6b completeness) — for when txGP is ITSELF a degree-Mp_gp split (the txP-input note is
// tokenOut_{j'} @ vout 2j' of txGP). A SEPARATE leaf per (Mp, j, M, Mp_gp) — a straight-line PICK-based reconstruction, NO OP_IF
// (lower-risk than nesting it into the genesis/transfer prefix; the adversarial review flagged hand-set arm depths as the most
// fragile). It reconstructs ALL 2Mp_gp+1 outputs of txGP — every tokenOut_k = value_k‖0x22‖ownSPK ⟹ out[2j']==ownSPK for ALL j'
// automatically (no j'-selection ⟹ no H2 needle-slide); every stateOut_k commits token_id==G — then `hash256(txGP) ‖ witness_vout
// == txP.vin0_outpoint`. **j' is FORCED by that EQUALVERIFY** (txP.vin0 is kernel-bound), NOT a leaf const. Mp_gp IS a leaf const
// (the reconstruction loop count). Depth-2 induction holds for splits: txP mined ⟹ the covenant ran on txGP.out[2j'] when txP
// spent it ⟹ txGP itself spent a covenant note (its own lineage was checked then). The pieces sit ABOVE the Wtotal leaf witness;
// PICK-built then DROPped ⟹ Wtotal intact, then splitFullLineageOps runs VERBATIM. ownSPK is the c4-bound witness (abs Wk+8).
export function splitGrandparentSplitPrefixOps(Mp, j, M, N, Mp_gp, { tokenId, changeSPK }) {
  if (!Number.isInteger(Mp_gp) || Mp_gp < 2 || Mp_gp > 4) throw new Error(`Mp_gp (grandparent degree) must be 2..4: ${Mp_gp}`);
  const VTI = vti(tokenId), vsChange = Buffer.concat([B(0x22), changeSPK]);
  const SPLIT_MID = splitMid(Mp_gp);
  const Wk = 3 + 3 * Mp, childBase = Wk + 10 + 2 * M, Wtotal = childBase + 2 * M * N + 2 * N;
  const ownSpkAbs = Wk + 8, vin0Abs = 1;                     // txP's vin0_outpoint (the grandparent pointer) is at abs 1
  const gpBase = Wtotal;                                     // the split-grandparent pieces above Wtotal
  const vinGPAbs = gpBase, changeValGpAbs = gpBase + 1, voutAbs = gpBase + 2;
  const valueAbs = (k) => gpBase + 3 + 3 * k, amountAbs = (k) => gpBase + 3 + 3 * k + 1, ownerAbs = (k) => gpBase + 3 + 3 * k + 2;
  const Pn = 3 + 3 * Mp_gp;

  const ops = []; let depth = Wtotal + Pn;
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  e(HDR_S);                                                  // acc = HDR_S (5B)
  pick(vinGPAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);  // acc ‖ txGP.vin0_outpoint (|·|==36)
  e(SPLIT_MID, O.OP_CAT);                                    // ‖ scriptSigLen‖seq‖voutCount(2Mp_gp+1)
  for (let k = 0; k < Mp_gp; k++) {
    pick(valueAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
    pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); // ‖ tokenOut_k = value_k‖0x22‖ownSPK
    e(VTI); pick(amountAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);                               // VTI ‖ amount_k
    pick(ownerAbs(k)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);                          // SHA256(state_k)
    e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);                 // ‖ stateOut_k = FRAME ‖ SHA256(state_k)
  }
  pick(changeValGpAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT, O.OP_CAT); // ‖ changeOut
  e(Buffer.from(LOCKTIME0), O.OP_CAT);                       // ‖ nLockTime = txGP
  e(O.OP_SHA256, O.OP_SHA256);                               // hash256(txGP)
  pick(voutAbs); e(O.OP_SIZE, enc(4), O.OP_EQUALVERIFY, O.OP_CAT);  // ‖ witness_vout(=u32le(2j'), |·|==4)
  pick(vin0Abs); e(O.OP_EQUALVERIFY);                        // hash256(txGP)‖2j' == txP.vin0_outpoint (forces j' + out[2j']==ownSPK)
  for (let k = 0; k < Pn; k++) e(O.OP_DROP);                 // drop the Pn grandparent pieces -> Wtotal intact
  return { ops };
}

export function splitFullLineageSplitGrandparentOps(Mp, j, M, N, Mp_gp, consts) {
  const { tokenId, changeSPK } = consts;
  return [...splitGrandparentSplitPrefixOps(Mp, j, M, N, Mp_gp, consts).ops, ...splitFullLineageOps(Mp, j, M, N, { tokenId, changeSPK }).ops];
}
export const buildSplitFullLineageSplitGrandparentLeaf = (Mp, j, M, N, Mp_gp, consts) => bells.script.compile(splitFullLineageSplitGrandparentOps(Mp, j, M, N, Mp_gp, consts));

// split-grandparent witness pieces (deepest→top) to APPEND above the splitFullLineageWitness. Builds txGP (a real degree-Mp_gp
// split) so the caller can set txP.vin0 = committedTxidGP ‖ u32le(2*jprime). kids = [{ value, amount(bigint), owner(20) }]_{Mp_gp}.
export function splitGrandparentSplit({ tokenId, ownSPK, changeSPK, gpVin0Outpoint, jprime, kids, changeValGp }) {
  const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const parts = [HDR_S, gpVin0Outpoint, splitMid(kids.length)];
  for (const c of kids) { parts.push(Buffer.concat([u64(c.value), B(0x22), ownSPK])); parts.push(Buffer.concat([FRAME, S(encState({ tokenId, amount: BigInt(c.amount), owner: c.owner }))])); }
  parts.push(Buffer.concat([u64(changeValGp), B(0x22), changeSPK]), Buffer.from(LOCKTIME0));
  const txGP = Buffer.concat(parts);
  const pieces = [gpVin0Outpoint, u64(changeValGp), u32le(2 * jprime)];
  for (const c of kids) pieces.push(u64(c.value), encAmt(BigInt(c.amount)), c.owner);
  return { txGP, pieces };
}
