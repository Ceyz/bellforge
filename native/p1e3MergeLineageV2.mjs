// P2-MERGE bricks 3/4 — the REACHABILITY core: reconstruct a 2-input/3-output MERGE parent tx byte-exact, so a MERGED note is
// spendable. Used in TWO positions: (A) as the depth-1 immediate-parent kernel when a split/1→1 leaf spends a merged note directly;
// (B) as the depth-2 gp='merge' grandparent prefix when a split/1→1 leaf spends a note whose grandparent was a merge. Both reuse the
// SAME byte assembly. A merge tx has 1 token output ⟹ the merged note is at vout0 (j=0). The 2-input/3-output shape reuses the
// FROZEN constants (HDR_G = 2-input header, VINTAIL, CONT_MID = VINTAIL‖voutCount(03), FRAME, LOCKTIME0) — measured byte-exact in
// p1e3_merge_lineage_v2.test.mjs against a real belcoinjs 2-input/3-output tx (never hand-guessed).
//
// merge tx = HDR_G ‖ vin0(36) ‖ VINTAIL ‖ vin1(36) ‖ CONT_MID ‖ tokenOut0(43) ‖ stateOut0(43) ‖ changeOut(43) ‖ LOCKTIME0.
import * as bells from 'belcoinjs-lib';
import { HDR_G, VINTAIL, CONT_MID, FRAME, LOCKTIME0, VOUT0_LE } from './p1e3Const.mjs';
import { STATE_V2_PREFIX, encodeStateV2 } from './wire.mjs';
import { u32 } from './sighashParts.mjs';
import { transferSendAllV2Ops, transferSendAllV2Witness } from './p1e3TransferV2.mjs';
import { splitFullLineageV2Ops, splitFullLineageV2Witness, withChangeWitness } from './p1e3SplitFullLineageV2.mjs';
import { splitGrandparentTransferV2PrefixOps, transferGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { limbNum, limbSer, amountLimbsN } from './amounts.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const N = 8;

// the merge-parent tx bytes (for committedTxidP) — the off-chain mirror of the on-stack reconstruction.
export function mergeParentTxBytes({ tokenId, ownSPK, changeSPK, vin0Outpoint, vin1Outpoint, value0, amount0, owner0, ownerType0, changeVal }) {
  const tokenOut0 = Buffer.concat([u64(value0), B(0x22), ownSPK]);
  const stateOut0 = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: ownerType0, tokenId, amount: BigInt(amount0), owner: owner0 }))]);
  const changeOut = Buffer.concat([u64(changeVal), B(0x22), changeSPK]);
  return Buffer.concat([HDR_G, vin0Outpoint, VINTAIL, vin1Outpoint, CONT_MID, tokenOut0, stateOut0, changeOut, Buffer.from(LOCKTIME0)]);
}

// witness (deepest→top): committedTxidP(32) ‖ vin0_outpoint(36) ‖ vin1_outpoint(36) ‖ changeVal(8) ‖ value0(8) ‖ amount0(8) ‖ owner0(20) ‖ owner_type0(1).
export function mergeParentV2Witness({ committedTxidP, vin0Outpoint, vin1Outpoint, changeVal, value0, amount0, owner0, ownerType0 }) {
  return [committedTxidP, vin0Outpoint, vin1Outpoint, u64(changeVal), u64(value0), u64(amount0), owner0, B(ownerType0)];
}

// Reconstruct the merge parent on-stack + PARK (amount_in, owner_in, owner_type_in) of the merged note @ vout0 (amount_in on top),
// hash256 == committedTxidP. Exposes vin0_outpoint (@ base+1) for the grandparent arm. `base`/`startDepth`/`extraAbove` relocate it
// (same composition semantics as splitParentReconstructV2Ops). ownSPK/changeSPK const by default; ownSpkAbs/changeSpkAbs make them witness.
export function mergeParentReconstructV2Ops({ tokenId, ownSPK, changeSPK, extraAbove = 0, base = 0, startDepth = null, ownSpkAbs = null, changeSpkAbs = null }) {
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(ownSPK) || ownSPK.length !== 34) throw new Error('ownSPK must be 34B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B (FUND-CRITICAL)');
  if (!Number.isInteger(extraAbove) || extraAbove < 0) throw new Error(`extraAbove must be a non-negative integer: ${extraAbove}`);
  if (!Number.isInteger(base) || base < 0) throw new Error(`base must be a non-negative integer: ${base}`);
  if (startDepth !== null && (!Number.isInteger(startDepth) || startDepth < 0)) throw new Error(`startDepth must be null or a non-negative integer: ${startDepth}`);
  const vsOwn = Buffer.concat([B(0x22), ownSPK]);
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const committedAbs = base + 0, vin0Abs = base + 1, vin1Abs = base + 2, changeValAbs = base + 3;
  const valueAbs = base + 4, amountAbs = base + 5, ownerAbs = base + 6, ownerTypeAbs = base + 7;
  const W = 8;
  const ops = []; let depth = startDepth ?? (W + extraAbove);
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  e(HDR_G);
  pick(vin0Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);                  // ‖ outpoint0 (the merge's vin0 — exposed for the gp arm)
  e(VINTAIL, O.OP_CAT);                                                             // ‖ vin0-tail
  pick(vin1Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);                 // ‖ outpoint1
  e(CONT_MID, O.OP_CAT);                                                            // ‖ vin1-tail ‖ voutCount(03)
  pick(valueAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                           // value0 pinned
  if (ownSpkAbs === null) e(vsOwn, O.OP_CAT, O.OP_CAT);                             // ‖ tokenOut0 (const ownSPK)
  else { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); }
  // stateOut0 = FRAME ‖ SHA256(0x02 ‖ owner_type0 ‖ token_id ‖ amount0 ‖ owner0)
  e(STATE_V2_PREFIX); pick(ownerTypeAbs); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT);
  e(tokenId, O.OP_CAT);
  pick(amountAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);
  pick(ownerAbs); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);
  e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);                                          // ‖ stateOut0
  pick(amountAbs); e(O.OP_TOALTSTACK); pick(ownerAbs); e(O.OP_TOALTSTACK); pick(ownerTypeAbs); e(O.OP_TOALTSTACK); // PARK amount_in, owner_in, owner_type_in
  pick(changeValAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                       // changeVal pinned
  if (changeSpkAbs === null) e(vsChange, O.OP_CAT, O.OP_CAT);                       // ‖ changeOut (const)
  else { pick(changeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); }
  e(Buffer.from(LOCKTIME0), O.OP_CAT);                                             // ‖ nLockTime = the merge tx
  e(O.OP_SHA256, O.OP_SHA256);                                                     // hash256(mergeTx)
  pick(committedAbs); e(O.OP_EQUALVERIFY);                                          // == committedTxidP
  e(O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_FROMALTSTACK);                       // [.., owner_type_in, owner_in, amount_in]
  return { ops, W };
}

// ----- CASE (A): spend a MERGED note DIRECTLY via 1→1 send-all. The immediate parent is the MERGE tx (mergeParentReconstruct via the
//   transferSendAllV2Ops `makeKernel` hook, Wk=8, voutLe=u32(0)); the depth-2 grandparent is the merge's vin0 SOURCE (a 1→1 transfer,
//   tight cap) — ONE arm suffices (proving vin0 was a covenant note ⟹ the merge leaf ran at vin0 ⟹ conservation held ⟹ induction).
export function mergeSpendVia1to1Ops({ tokenId, ownSPK, changeSPK, changeWitness = false }) {
  const CW = changeWitness === true;
  const Wk = 8;                                                                    // the merge kernel's witness width
  const makeKernel = (extraAbove, ownSpkAbs, changeSpkAbs) => mergeParentReconstructV2Ops({ tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove, ownSpkAbs, changeSpkAbs });
  const body = transferSendAllV2Ops(1, 0, N, { tokenId, changeSPK, makeKernel, Wk, voutLe: u32(0), changeWitness: CW }); // CW ⟹ the merge tx's change is WITNESS (parChangeSpk) — required: a real merge uses a witness change, so a baked reconstruction would not hash-match
  const Wbody = body.Wtotal;                                                       // base Wk + 14 = 22 (transferSendAllV2Ops returns the BASE)
  const Wbody_eff = Wbody + (CW ? 2 : 0);                                          // the actual witness height (+ curChange/parChange)
  const ownSpkAbs = Wk + 8, Pn = 6;                                               // ownSPK @ 16 in the 1→1 body
  const gp = splitGrandparentTransferV2PrefixOps(1, 0, 2, N, { tokenId, leafWtotal: Wbody_eff, loc: { vin0Abs: 1, ownSpkAbs, gpBase: Wbody_eff, startDepth: Wbody_eff + Pn } });
  return { ops: [...gp.ops, ...body.ops], Wtotal: Wbody_eff + Pn };
}
export const buildMergeSpendVia1to1Leaf = (consts) => bells.script.compile(mergeSpendVia1to1Ops(consts).ops);

// witness (deepest→top): the merge kernel slice (8) ‖ the 1→1 epilogue/output (sig,P,c1,c3,c5,c7,c8,c9,ownSPK,changeValue,
//   out.owner,out.value,out.ownerType,amount_ser_out) ‖ [cw: curChangeSpk(the 1→1 tx change), parChangeSpk(the MERGE tx change)] ‖
//   the transfer-grandparent pieces (of merge.vin0's source).
export function mergeSpendVia1to1Witness({ mergeParent, gpArgs, epi, ownSPK, changeValue, out, amountIn, cw }) {
  const bodyW = [...mergeParentV2Witness(mergeParent),
    epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue), out.owner, u64(out.value), B(out.ownerType), u64(amountIn)];
  if (cw) bodyW.push(cw.curChangeSpk, cw.parChangeSpk);                            // transferSendAllV2 CW layout: curChange then parChange
  return [...bodyW, ...transferGrandparentV2(gpArgs).pieces];
}

// ----- CASE (B): the gp='merge' GRANDPARENT PREFIX. Spend a note N whose immediate parent is a 1→1/split (txP) and txP.vin0 came
//   from a MERGE tx (txGP = merge) — i.e. N is the child of a case-(A) spend. The prefix reconstructs the merge txGP byte-exact and
//   forces hash256(txGP)‖vout0 == txP.vin0, then DROPs its 7 pieces so the spend leaf runs verbatim. Mirrors the transfer-gp prefix
//   but for the 2-input/3-output merge shape. ownSPK is PICKED from the leaf's witness (@ ownSpkAbs); changeSPK is the baked const
//   (matches the merge leaf's const change — TODO: changeWitness for both before freeze). `loc` REQUIRED: {vin0Abs, ownSpkAbs, gpBase, startDepth}.
export function mergeGrandparentV2PrefixOps({ tokenId, changeSPK, loc, changeWitness = false }) {
  const CW = changeWitness === true;                                               // CW: the merge txGP's change is WITNESS (changeSpkGP) — a real merge uses a witness change, so a baked reconstruction would not hash-match
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const { vin0Abs, ownSpkAbs, gpBase, startDepth } = loc;
  const vinGP0Abs = gpBase, vinGP1Abs = gpBase + 1, changeValGPAbs = gpBase + 2, valueGP0Abs = gpBase + 3, amtGP0Abs = gpBase + 4, ownerGP0Abs = gpBase + 5, ownerTypeGP0Abs = gpBase + 6;
  const changeSpkGPAbs = gpBase + 7;                                               // CW only: the 8th piece
  const Pn = 7 + (CW ? 1 : 0);
  const ops = []; let depth = startDepth;
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  e(HDR_G);
  pick(vinGP0Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);                // ‖ outpoint0
  e(VINTAIL, O.OP_CAT);                                                             // ‖ vin0-tail
  pick(vinGP1Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);               // ‖ outpoint1
  e(CONT_MID, O.OP_CAT);                                                            // ‖ vin1-tail ‖ voutCount(03)
  pick(valueGP0Abs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT);  // ‖ tokenOut0
  e(STATE_V2_PREFIX); pick(ownerTypeGP0Abs); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT);
  e(tokenId, O.OP_CAT);
  pick(amtGP0Abs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);
  pick(ownerGP0Abs); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);
  e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);                                          // ‖ stateOut0
  pick(changeValGPAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  if (CW) { pick(changeSpkGPAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); } // ‖ changeOut (witness)
  else e(vsChange, O.OP_CAT, O.OP_CAT);                                             // ‖ changeOut (const)
  e(Buffer.from(LOCKTIME0), O.OP_CAT, O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT); // hash256(txGP)‖vout0
  pick(vin0Abs); e(O.OP_EQUALVERIFY);                                               // == txP.vin0
  for (let k = 0; k < Pn; k++) e(O.OP_DROP);
  return { ops, Pn };
}
// the gp='merge' witness pieces (deepest→top): vinGP0(36) ‖ vinGP1(36) ‖ changeValGP(8) ‖ valueGP0(8) ‖ amtGP0(8) ‖ ownerGP0(20) ‖ ownerTypeGP0(1) [‖ changeSpkGP(34) if cw].
export function mergeGrandparentV2Pieces({ vinGP0, vinGP1, changeValGP, valueGP0, amtGP0, ownerGP0, ownerTypeGP0, changeSpkGP }, cw) {
  const p = [vinGP0, vinGP1, u64(changeValGP), u64(valueGP0), u64(amtGP0), ownerGP0, B(ownerTypeGP0)];
  if (cw) p.push(changeSpkGP);
  return p;
}

// compose gp='merge' with the 1→1 SEND-ALL leaf: spend a transfer-note whose grandparent was a merge. (Split variant is analogous.)
export function transferMergeGrandparentV2Ops(Mp, j, Nn, consts) {
  const CW = consts.changeWitness === true, SCRIPT = consts.arm === 'script';
  const body = transferSendAllV2Ops(Mp, j, Nn, consts);                            // 1→1 of a child of a degree-Mp parent; its own CW/SCRIPT if set
  const Wbody_eff = body.Wtotal + (SCRIPT ? 4 : 0) + (CW ? 2 : 0);
  const ownSpkAbs = (3 + 4 * Mp) + 8, Pn = 7 + (CW ? 1 : 0);                        // ownSPK @ Wk+8
  const gp = mergeGrandparentV2PrefixOps({ tokenId: consts.tokenId, changeSPK: consts.changeSPK, changeWitness: CW, loc: { vin0Abs: 1, ownSpkAbs, gpBase: Wbody_eff, startDepth: Wbody_eff + Pn } });
  return { ops: [...gp.ops, ...body.ops], Wtotal: Wbody_eff + Pn };
}
export function transferMergeGrandparentV2Witness({ parent, mergeGp, epi, ownSPK, changeValue, out, amountIn, cw, script }) {
  const bodyW = transferSendAllV2Witness({ parent, epi, ownSPK, changeValue, out, amountIn });
  if (script) bodyW.push(script.outpoint1, script.controllerSPK, script.poolId, script.stateId); // SCRIPT arm: the 4 controller fields ABOVE the base (matches transferSendAllV2Ops cwBase = Wtotal + 4)
  if (cw) bodyW.push(cw.curChangeSpk, cw.parChangeSpk);                             // the 1→1 leaf's CW (current spend + txP parent change)
  return [...bodyW, ...mergeGrandparentV2Pieces(mergeGp, cw)];
}

// ----- the SPLIT variants (same hooks): (a) case-A-via-SPLIT — spend a merged note → M children (KEY-only); (b) gp='merge' into SPLIT
//   — spend a note (immediate parent split/1→1) whose grandparent was a merge (both arms). These complete the reachability family for
//   the freeze enumeration. The 1→1 variants above + these = every reachable merge note class is spendable.
export function mergeSpendViaSplitOps(M, { tokenId, ownSPK, changeSPK, changeWitness = false }) {
  const CW = changeWitness === true, Wk = 8;
  const makeKernel = (extraAbove, ownSpkAbs, changeSpkAbs) => mergeParentReconstructV2Ops({ tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove, ownSpkAbs, changeSpkAbs });
  const body = splitFullLineageV2Ops(1, 0, M, N, { tokenId, changeSPK, makeKernel, Wk, voutLe: u32(0), changeWitness: CW }); // KEY-only ⟹ no SCRIPT fields
  const Wbody_eff = body.Wtotal + (CW ? 2 : 0);
  const ownSpkAbs = Wk + 8, Pn = 6;
  const gp = splitGrandparentTransferV2PrefixOps(1, 0, M, N, { tokenId, leafWtotal: Wbody_eff, loc: { vin0Abs: 1, ownSpkAbs, gpBase: Wbody_eff, startDepth: Wbody_eff + Pn } });
  return { ops: [...gp.ops, ...body.ops], Wtotal: Wbody_eff + Pn };
}
export function splitMergeGrandparentV2Ops(Mp, j, M, Nn, consts) {
  const CW = consts.changeWitness === true, SCRIPT = consts.arm === 'script';
  const body = splitFullLineageV2Ops(Mp, j, M, Nn, consts);
  const Wbody_eff = body.Wtotal + (SCRIPT ? 4 : 0) + (CW ? 2 : 0);
  const Wk = 3 + 4 * Mp, ownSpkAbs = Wk + 8, Pn = 7 + (CW ? 1 : 0);
  const gp = mergeGrandparentV2PrefixOps({ tokenId: consts.tokenId, changeSPK: consts.changeSPK, changeWitness: CW, loc: { vin0Abs: 1, ownSpkAbs, gpBase: Wbody_eff, startDepth: Wbody_eff + Pn } });
  return { ops: [...gp.ops, ...body.ops], Wtotal: Wbody_eff + Pn };
}

// witness builders for the SPLIT variants (KEY arm). mergeSpendViaSplit: the merge kernel slice replaces the split kernel slice.
const _pairs = (v) => { const L = amountLimbsN(BigInt(v), N); const w = []; for (let i = 0; i < N; i++) w.push(limbNum(L[i]), limbSer(L[i])); return w; };
export function mergeSpendViaSplitWitness({ mergeParent, gpArgs, epi, ownSPK, changeValue, outs, amountIn, cw }) {
  const w = mergeParentV2Witness(mergeParent);                                     // the 8-item merge kernel slice
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue));
  for (const o of outs) w.push(o.owner, u64(o.value), B(o.ownerType));
  for (const o of outs) w.push(..._pairs(o.amount));
  w.push(..._pairs(amountIn));
  if (cw) w.push(cw.curChangeSpk, cw.parChangeSpk);
  return [...w, ...transferGrandparentV2(gpArgs).pieces];
}
export function splitMergeGrandparentV2Witness({ parent, mergeGp, epi, ownSPK, changeValue, outs, amountIn, cw }) {
  let w = splitFullLineageV2Witness({ parent, epi, ownSPK, changeValue, outs, amountIn, N });
  if (cw) w = withChangeWitness(w, cw);
  return [...w, ...mergeGrandparentV2Pieces(mergeGp, cw)];
}
