// P2-0 BRICK 0 — the v2 (owner_type) grandparent arms for the split-child leaf. ALL THREE shapes {genesis, transfer-1→1, split}
// as SEPARATE straight-line PICK-based leaves (no nested OP_IF — lower-risk per the audit; the v1 split arm was already this).
// Each reconstructs txGP with the v2 stateOut preimage (0x02 ‖ owner_type ‖ token_id ‖ amount ‖ owner) and forces
// hash256(txGP) ‖ vout_gp == txP.vin0_outpoint (vout_gp = 0 for genesis/transfer, = 2j' for split). Composed as a PREFIX above
// the Wtotal v2-leaf witness (PICK-built then DROPped ⟹ Wtotal intact, then splitFullLineageV2Ops runs verbatim).
import * as bells from 'belcoinjs-lib';
import { HDR_T, HDR_G, CONT_MID, genMid, FRAME, VOUT0_LE, LOCKTIME0 } from './p1e3Const.mjs';
import { HDR_S, splitMid } from './p1e3SplitConst.mjs';
import { STATE_V2_PREFIX, OwnerType, encodeStateV2, encodeAmount as encAmt } from './wire.mjs';
import { u64 } from './sighashParts.mjs';
import { splitFullLineageV2Ops } from './p1e3SplitFullLineageV2.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

// the v2 leaf's witness layout (Wk = 3 + 4·Mp, split-leaf current outputs 3 fields each) — the grandparent pieces sit above Wtotal.
// `leafWtotal` override (REUSE): the grandparent prefixes are leaf-agnostic above Wtotal (they pick ownSPK @ Wk+8 + txP.vin0 @ 1,
// both Wk-relative); pass a different leaf's Wtotal (e.g. the 1→1 send-all leaf = Wk+14, no limb pairs) to compose with it.
function v2layout(Mp, M, N, leafWtotal) {
  const Wk = 3 + 4 * Mp, splitWtotal = (Wk + 10 + 3 * M) + 2 * M * N + 2 * N;
  return { Wk, Wtotal: leafWtotal ?? splitWtotal, ownSpkAbs: Wk + 8, vin0Abs: 1 };
}
export const splitV2Wtotal = (Mp, M, N) => (3 + 4 * Mp + 10 + 3 * M) + 2 * M * N + 2 * N;
export const transferV2Wtotal = (Mp) => (3 + 4 * Mp) + 14; // the 1→1 send-all leaf (transferSendAllV2Ops)
const mkE = (ops, depthRef) => {
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depthRef.d += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depthRef.d - 1 - abs), O.OP_PICK); depthRef.d += 1; };
  return { e, pick };
};
// the v2 stateOut_k build (acc-appending): consumes nothing of acc; needs owner_type_k/amount_k/owner_k via pick(absFns).
const catStateOutV2 = (e, pick, tokenId, ownerTypeAbs, amountAbs, ownerAbs) => {
  e(STATE_V2_PREFIX); pick(ownerTypeAbs); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT);   // 0x02 ‖ owner_type
  e(tokenId, O.OP_CAT);                                                                        // ‖ token_id
  pick(amountAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);                            // ‖ amount
  pick(ownerAbs); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);               // ‖ owner -> SHA256(state v2)
  e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);                                                      // ‖ stateOut = FRAME ‖ SHA256
};

// ----- SPLIT grandparent (txGP a degree-Mp_gp split; the txP-input note @ vout 2j', j' FORCED by the EQUALVERIFY). v2.
export function splitGrandparentSplitV2PrefixOps(Mp, j, M, N, Mp_gp, { tokenId, changeSPK, leafWtotal, changeWitnessGp = false }) {
  if (!Number.isInteger(Mp_gp) || Mp_gp < 2 || Mp_gp > 4) throw new Error(`Mp_gp must be 2..4: ${Mp_gp}`);
  const vsChange = Buffer.concat([B(0x22), changeSPK]), SPLIT_MID = splitMid(Mp_gp);
  const { Wtotal, ownSpkAbs, vin0Abs } = v2layout(Mp, M, N, leafWtotal);
  const gpBase = Wtotal, vinGPAbs = gpBase, changeValGpAbs = gpBase + 1, voutAbs = gpBase + 2;
  const valueAbs = (k) => gpBase + 3 + 4 * k, amountAbs = (k) => gpBase + 3 + 4 * k + 1, ownerAbs = (k) => gpBase + 3 + 4 * k + 2, ownerTypeAbs = (k) => gpBase + 3 + 4 * k + 3;
  // BRICK 2 — the SPLIT grandparent's OWN change witness (appended ABOVE the kids; the genesis/transfer gp changes are already
  // witness via changeSPKgp/tailGP). Bound by the txGP hash → txP.vin0 match (a wrong gp change ⟹ a different txGP txid ⟹ reject).
  const CWG = changeWitnessGp === true;
  const changeSpkGpAbs = gpBase + 3 + 4 * Mp_gp;
  const Pn = 3 + 4 * Mp_gp + (CWG ? 1 : 0);
  const ops = [], dr = { d: Wtotal + Pn }; const { e, pick } = mkE(ops, dr);
  e(HDR_S);
  pick(vinGPAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);
  e(SPLIT_MID, O.OP_CAT);
  for (let k = 0; k < Mp_gp; k++) {
    pick(valueAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
    pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); // tokenOut_k
    catStateOutV2(e, pick, tokenId, ownerTypeAbs(k), amountAbs(k), ownerAbs(k));
  }
  pick(changeValGpAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  if (CWG) { pick(changeSpkGpAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); } // witness gp change
  else e(vsChange, O.OP_CAT, O.OP_CAT);                                                          // const gp change
  e(Buffer.from(LOCKTIME0), O.OP_CAT, O.OP_SHA256, O.OP_SHA256);
  pick(voutAbs); e(O.OP_SIZE, enc(4), O.OP_EQUALVERIFY, O.OP_CAT);
  pick(vin0Abs); e(O.OP_EQUALVERIFY);
  for (let k = 0; k < Pn; k++) e(O.OP_DROP);
  return { ops };
}

// ----- GENESIS grandparent (txGP = the 2-input mint; the note @ vout0). v2: stateOut0 is the v2 const (genesis note = KEY-owned).
export function splitGrandparentGenesisV2PrefixOps(Mp, j, M, N, { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, leafWtotal }) {
  const stateOut0 = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const valPrefix = Buffer.concat([u64(VALUE_0), B(0x22)]);
  const { Wtotal, ownSpkAbs, vin0Abs } = v2layout(Mp, M, N, leafWtotal);
  const gpBase = Wtotal, mgpAbs = gpBase, changeValGpAbs = gpBase + 1, changeSPKgpAbs = gpBase + 2;
  const Pn = 3;
  const ops = [], dr = { d: Wtotal + Pn }; const { e, pick } = mkE(ops, dr);
  e(HDR_G);
  pick(mgpAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);   // ‖ M_gp (minter outpoint @ vin0)
  e(genMid(tokenId), O.OP_CAT);                                      // ‖ vin0-tail ‖ G ‖ vin1-tail ‖ voutCount(04)
  e(valPrefix); pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_CAT); // ‖ tokenNote0 = VALUE_0‖0x22‖ownSPK
  e(stateOut0, O.OP_CAT, feeOut, O.OP_CAT);                          // ‖ stateOut0(v2 const) ‖ feeOut(const)
  pick(changeValGpAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);      // changeValGp
  pick(changeSPKgpAbs); e(O.OP_SIZE, enc(changeSpkLen), O.OP_EQUALVERIFY, B(changeSpkLen), O.OP_SWAP, O.OP_CAT, O.OP_CAT); // ‖ changeOut_gp
  e(O.OP_CAT, Buffer.from(LOCKTIME0), O.OP_CAT);                     // (acc ‖ changeOut_gp) ‖ locktime = txGP_mint
  e(O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT);      // hash256(txGP) ‖ 0x00000000
  pick(vin0Abs); e(O.OP_EQUALVERIFY);
  for (let k = 0; k < Pn; k++) e(O.OP_DROP);
  return { ops };
}

// ----- TRANSFER-1→1 grandparent (txGP = a mono-input transfer; the note @ vout0). v2 stateOut_GP. owner_type_GP is witness.
// `loc` override (MERGE reuse): the prefix normally derives {vin0Abs=1, ownSpkAbs=Wk+8, gpBase=Wtotal, startDepth=Wtotal+Pn} from the
// split layout. A K=2 merge leaf runs TWO of these prefixes, bound to DIFFERENT kernels (txP.vin0 @ abs 1 for self, @ abs Wk+1 for
// other) with ownSPK at the merge's position and the gp pieces stacked above the body witness — so it passes explicit positions.
// Absent ⟹ byte-identical to the split/1→1 composers.
export function splitGrandparentTransferV2PrefixOps(Mp, j, M, N, { tokenId, changeSPK, leafWtotal, loc }) {
  const lay = v2layout(Mp, M, N, leafWtotal);
  const ownSpkAbs = loc?.ownSpkAbs ?? lay.ownSpkAbs, vin0Abs = loc?.vin0Abs ?? lay.vin0Abs;
  const Pn = 6;
  const gpBase = loc?.gpBase ?? lay.Wtotal, startD = loc?.startDepth ?? (lay.Wtotal + Pn);
  const vinGPAbs = gpBase, valGPAbs = gpBase + 1, ownerGPAbs = gpBase + 2, amtGPAbs = gpBase + 3, ownerTypeGPAbs = gpBase + 4, tailGPAbs = gpBase + 5;
  const ops = [], dr = { d: startD }; const { e, pick } = mkE(ops, dr);
  e(HDR_T);
  pick(vinGPAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);
  e(CONT_MID, O.OP_CAT);
  pick(valGPAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT);  // ‖ tokenOut0_GP = valGP‖0x22‖ownSPK
  catStateOutV2(e, pick, tokenId, ownerTypeGPAbs, amtGPAbs, ownerGPAbs);                                      // ‖ stateOut_GP (v2)
  pick(tailGPAbs); e(O.OP_CAT);                                                                               // ‖ tailGP (changeOut ‖ locktime)
  e(O.OP_SHA256, O.OP_SHA256, Buffer.from(VOUT0_LE), O.OP_CAT);
  pick(vin0Abs); e(O.OP_EQUALVERIFY);
  for (let k = 0; k < Pn; k++) e(O.OP_DROP);
  return { ops };
}

// composes — the gp prefix's gpBase = the leaf's Wtotal_eff. splitLeafW accounts for the SCRIPT +4 AND the changeWitness +2 (both
// read from consts.arm/consts.changeWitness), so a CW or SCRIPT leaf places the gp pieces at the right depth. The FULL consts flow to
// BOTH the leaf (arm + changeWitness) and the prefix (AMOUNT_0/feeOut for genesis, Mp_gp for split). The split-gp prefix ALSO gets
// changeWitnessGp (its OWN change witness); the genesis/transfer gp changes are already witness (changeSPKgp/tailGP). Non-CW non-SCRIPT
// ⟹ leafWtotal == the v2layout default ⟹ byte-identical to before.
const splitLeafW = (Mp, M, N, consts) => splitV2Wtotal(Mp, M, N) + (consts.arm === 'script' ? 4 : 0) + (consts.changeWitness ? 2 : 0);
const gpC = (Mp, M, N, consts, extra = {}) => ({ ...consts, leafWtotal: splitLeafW(Mp, M, N, consts), ...extra });
export const splitFullLineageGenesisGrandparentV2Ops = (Mp, j, M, N, consts) => [...splitGrandparentGenesisV2PrefixOps(Mp, j, M, N, gpC(Mp, M, N, consts)).ops, ...splitFullLineageV2Ops(Mp, j, M, N, consts).ops];
export const splitFullLineageTransferGrandparentV2Ops = (Mp, j, M, N, consts) => [...splitGrandparentTransferV2PrefixOps(Mp, j, M, N, gpC(Mp, M, N, consts)).ops, ...splitFullLineageV2Ops(Mp, j, M, N, consts).ops];
export const splitFullLineageSplitGrandparentV2Ops = (Mp, j, M, N, Mp_gp, consts) => [...splitGrandparentSplitV2PrefixOps(Mp, j, M, N, Mp_gp, gpC(Mp, M, N, consts, { changeWitnessGp: consts.changeWitness === true })).ops, ...splitFullLineageV2Ops(Mp, j, M, N, consts).ops];
export const buildSplitFullLineageGenesisGrandparentV2Leaf = (Mp, j, M, N, consts) => bells.script.compile(splitFullLineageGenesisGrandparentV2Ops(Mp, j, M, N, consts));
export const buildSplitFullLineageTransferGrandparentV2Leaf = (Mp, j, M, N, consts) => bells.script.compile(splitFullLineageTransferGrandparentV2Ops(Mp, j, M, N, consts));
export const buildSplitFullLineageSplitGrandparentV2Leaf = (Mp, j, M, N, Mp_gp, consts) => bells.script.compile(splitFullLineageSplitGrandparentV2Ops(Mp, j, M, N, Mp_gp, consts));

// ----- the SAME grandparent prefixes composed with the 1→1 SEND-ALL leaf (REUSE via leafWtotal = transferV2Wtotal(Mp); M/j are
//       unused by the prefixes — they pick ownSPK @ Wk+8 + txP.vin0 @ 1). So a split-child note can be 1→1-transferred under a
//       proven lineage to genesis. The fund-safe transfer family for split-children.
import { transferSendAllV2Ops } from './p1e3TransferV2.mjs';
const transferLeafW = (Mp, consts) => transferV2Wtotal(Mp) + (consts.arm === 'script' ? 4 : 0) + (consts.changeWitness ? 2 : 0);
const tgpC = (Mp, consts, extra = {}) => ({ ...consts, leafWtotal: transferLeafW(Mp, consts), ...extra });
export const transferGenesisGrandparentV2Ops = (Mp, j, N, consts) => [...splitGrandparentGenesisV2PrefixOps(Mp, j, 2, N, tgpC(Mp, consts)).ops, ...transferSendAllV2Ops(Mp, j, N, consts).ops];
export const transferTransferGrandparentV2Ops = (Mp, j, N, consts) => [...splitGrandparentTransferV2PrefixOps(Mp, j, 2, N, tgpC(Mp, consts)).ops, ...transferSendAllV2Ops(Mp, j, N, consts).ops];
export const transferSplitGrandparentV2Ops = (Mp, j, N, Mp_gp, consts) => [...splitGrandparentSplitV2PrefixOps(Mp, j, 2, N, Mp_gp, tgpC(Mp, consts, { changeWitnessGp: consts.changeWitness === true })).ops, ...transferSendAllV2Ops(Mp, j, N, consts).ops];

// ----- the SAME grandparent prefixes composed with the SCRIPT-arm split leaf = the KEY composers with arm:'script' (splitLeafW picks
//       up the +4 from consts.arm, and the leaf gets the SCRIPT arm). So a SCRIPT note has a proven lineage to genesis.
export const splitScriptGenesisGrandparentV2Ops = (Mp, j, M, N, consts) => splitFullLineageGenesisGrandparentV2Ops(Mp, j, M, N, { ...consts, arm: 'script' });
export const splitScriptSplitGrandparentV2Ops = (Mp, j, M, N, Mp_gp, consts) => splitFullLineageSplitGrandparentV2Ops(Mp, j, M, N, Mp_gp, { ...consts, arm: 'script' });

// witness builders (build txGP with v2 stateOuts → committedTxidGP; pieces deepest→top above the v2-leaf witness)
export function genesisGrandparentV2({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeSPKgp, changeValueGp }) {
  const stateOut0 = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const txGP = Buffer.concat([HDR_G, mintOutpoint, genMid(tokenId), Buffer.concat([u64(VALUE_0), B(0x22), ownSPK]), stateOut0, feeOut, Buffer.concat([u64(changeValueGp), B(0x22), changeSPKgp]), Buffer.from(LOCKTIME0)]);
  return { txGP, pieces: [mintOutpoint, u64(changeValueGp), changeSPKgp] };
}
export function transferGrandparentV2({ tokenId, ownSPK, gpVin0Outpoint, valGP, ownerGP, amtGP, ownerTypeGP, tailGP }) {
  const stateOutGP = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: ownerTypeGP, tokenId, amount: BigInt(amtGP), owner: ownerGP }))]);
  const txGP = Buffer.concat([HDR_T, gpVin0Outpoint, CONT_MID, Buffer.concat([u64(valGP), B(0x22), ownSPK]), stateOutGP, tailGP]);
  return { txGP, pieces: [gpVin0Outpoint, u64(valGP), ownerGP, u64(amtGP), B(ownerTypeGP), tailGP] };
}
export function splitGrandparentSplitV2({ tokenId, ownSPK, changeSPK, gpVin0Outpoint, jprime, kids, changeValGp, changeSpkGp }) {
  const gpChange = changeSpkGp || changeSPK;   // BRICK 2: the gp's ACTUAL change address (witness-chosen when changeSpkGp is supplied)
  const parts = [HDR_S, gpVin0Outpoint, splitMid(kids.length)];
  for (const c of kids) { parts.push(Buffer.concat([u64(c.value), B(0x22), ownSPK])); parts.push(Buffer.concat([FRAME, S(encodeStateV2({ ownerType: c.ownerType, tokenId, amount: BigInt(c.amount), owner: c.owner }))])); }
  parts.push(Buffer.concat([u64(changeValGp), B(0x22), gpChange]), Buffer.from(LOCKTIME0));
  const txGP = Buffer.concat(parts);
  const pieces = [gpVin0Outpoint, u64(changeValGp), u32le(2 * jprime)];
  for (const c of kids) pieces.push(u64(c.value), encAmt(BigInt(c.amount)), c.owner, B(c.ownerType));
  if (changeSpkGp) pieces.push(changeSpkGp);   // append the gp change witness (matches changeSpkGpAbs = gpBase + 3 + 4·Mp_gp)
  return { txGP, pieces };
}
