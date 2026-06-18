// P2-0 BRICK 0 — the STATE v2 (owner_type) lineage kernel. The TIER-FULL freeze (user: lending/pools/burn without redeploy) bakes
// owner_type INTO the committed state: v2 = 0x02 ‖ owner_type(1) ‖ token_id(36) ‖ amount(8) ‖ owner(20) = 66B (wire.encodeStateV2),
// owner_type at byte offset 1. This is the +1-byte shift the adversarial review flagged as BRICK 0's #1 risk — so it is re-proven
// on the SMALLEST reused piece (the parent reconstruction) FIRST, alongside the proven v1 kernel (p1e3SplitLineage.mjs) for diffing.
//
// vs v1: (a) each parent output carries a per-note owner_type_k (1B) in the witness; (b) the stateOut_k preimage is rebuilt as
// 0x02 ‖ owner_type_k ‖ token_id ‖ amount_k ‖ owner_k (NOT 0x01 ‖ token_id ‖ amount_k ‖ owner_k); (c) the kernel PARKS owner_type_in
// too (amount_in, owner_in, owner_type_in). NO owner_type VALIDATION here — the kernel reconstructs an ALREADY-MINED parent
// (its owner_types were validated by the covenant that CREATED it, and are hash-bound to committedTxidP); validation + the
// auth-arm-selection-by-owner_type_in live in the SPEND leaves. Output-side owner_types stay FREE (spender-chosen, c6-bound) so
// key↔script transitions (deposit into a pool = key→script; withdraw = script→key) are expressible.
import * as bells from 'belcoinjs-lib';
import { FRAME } from './p1e3Const.mjs';
import { HDR_S, splitMid, LOCKTIME0 } from './p1e3SplitConst.mjs';
import { STATE_V2_PREFIX } from './wire.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

// witness (deepest→top): committedTxidP(32) ‖ vin0_outpoint(36) ‖ changeVal(8) ‖ [ value_k(8) ‖ amount_k(8) ‖ owner_k(20) ‖
//   owner_type_k(1) ]_{k=0..M'-1}. Leaves [.., owner_type_in, owner_in, amount_in] (amount_in on top). committedTxidP hash-checked.
// `extraAbove`/`ownSpkAbs` = the composition params (identical semantics to the v1 kernel).
// MERGE composition (`base`/`startDepth`): the kernel normally anchors its witness slice at stack-bottom (abs 0). A MERGE leaf runs
// TWO kernels on one stack, so the SECOND must read a slice that sits `base` items above the bottom. `base` shifts every absolute
// index by that amount; `startDepth` overrides the initial stack height (which must count items BOTH below the slice — `base` of them —
// AND above it, e.g. the first kernel's 3 parked registers). DEFAULTS (base=0, startDepth=null ⟹ depth=W+extraAbove) are BYTE-IDENTICAL
// to the pre-merge kernel, so every existing single-kernel call site is unchanged. (Proven composable in _audit_merge_peak.mjs.)
export function splitParentReconstructV2Ops(M, j, { tokenId, ownSPK, changeSPK, extraAbove = 0, ownSpkAbs = null, changeSpkAbs = null, base = 0, startDepth = null }) {
  // M = the PARENT degree (the degree of the split that created the spent note). M=1 is the TRANSFER-PARENT base case: a 1→1 tx is a
  // degree-1 "split" — HDR_S==HDR_T and splitMid(1)==CONT_MID (verified), so this kernel reconstructs the voutCount-3 transfer parent
  // BYTE-EXACT. That closes the transfer-note reachability gap WITHOUT a new kernel (the spent note is always at vout0 ⟹ j=0). The
  // CURRENT-split degree M_out (how many children a spend CREATES) is a separate ≥2 constraint enforced by the host leaf, not here.
  if (!Number.isInteger(M) || M < 1 || M > 4) throw new Error(`M' (parent degree) must be 1..4 (1=transfer-parent, M_MAX=4): ${M}`);
  if (!Number.isInteger(j) || j < 0 || j >= M) throw new Error(`j must be 0..${M - 1}: ${j}`);
  if (!Number.isInteger(extraAbove) || extraAbove < 0) throw new Error(`extraAbove must be a non-negative integer: ${extraAbove}`);
  if (ownSpkAbs !== null && (!Number.isInteger(ownSpkAbs) || ownSpkAbs < 0)) throw new Error(`ownSpkAbs must be null or a non-negative integer: ${ownSpkAbs}`);
  if (changeSpkAbs !== null && (!Number.isInteger(changeSpkAbs) || changeSpkAbs < 0)) throw new Error(`changeSpkAbs must be null or a non-negative integer: ${changeSpkAbs}`);
  if (!Number.isInteger(base) || base < 0) throw new Error(`base must be a non-negative integer: ${base}`);
  if (startDepth !== null && (!Number.isInteger(startDepth) || startDepth < 0)) throw new Error(`startDepth must be null or a non-negative integer: ${startDepth}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(ownSPK) || ownSPK.length !== 34) throw new Error('ownSPK must be 34B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B (FUND-CRITICAL: non-34B change ⟹ unspendable children)');
  const vsOwn = Buffer.concat([B(0x22), ownSPK]);
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const SPLIT_MID = splitMid(M);
  const committedAbs = base + 0, vin0Abs = base + 1, changeValAbs = base + 2;
  const FW = 4;                                            // fields per output: value, amount, owner, owner_type
  const valueAbs = (k) => base + 3 + FW * k, amountAbs = (k) => base + 3 + FW * k + 1, ownerAbs = (k) => base + 3 + FW * k + 2, ownerTypeAbs = (k) => base + 3 + FW * k + 3;
  const W = 3 + FW * M;

  const ops = []; let depth = startDepth ?? (W + extraAbove);
  const DELTA = {
    [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0,
    [O.OP_EQUALVERIFY]: -2,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  e(HDR_S);
  pick(vin0Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);   // acc ‖ vin0_outpoint (the grandparent pointer)
  e(SPLIT_MID, O.OP_CAT);                                            // acc ‖ scriptSigLen‖seq‖voutCount(2M+1)
  for (let k = 0; k < M; k++) {
    pick(valueAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);        // value_k pinned
    if (ownSpkAbs === null) e(vsOwn, O.OP_CAT, O.OP_CAT);            // const ownSPK → tokenOut_k
    else { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); } // witness ownSPK → tokenOut_k
    // stateOut_k preimage = 0x02 ‖ owner_type_k ‖ token_id ‖ amount_k ‖ owner_k   (the v2 +1-byte shift)
    e(STATE_V2_PREFIX); pick(ownerTypeAbs(k)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT);   // 0x02 ‖ owner_type_k (|·|==1)
    e(tokenId, O.OP_CAT);                                            // ‖ token_id
    pick(amountAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);                           // ‖ amount_k
    pick(ownerAbs(k)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);              // ‖ owner_k -> SHA256(state v2)
    e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);                         // ‖ stateOut_k = FRAME ‖ SHA256(state v2)
    if (k === j) { pick(amountAbs(k)); e(O.OP_TOALTSTACK); pick(ownerAbs(k)); e(O.OP_TOALTSTACK); pick(ownerTypeAbs(k)); e(O.OP_TOALTSTACK); } // PARK amount_in, owner_in, owner_type_in
  }
  pick(changeValAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                                        // changeVal pinned
  if (changeSpkAbs === null) e(vsChange, O.OP_CAT, O.OP_CAT);       // const changeSPK → changeOut (baked; byte-identical default)
  else { pick(changeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); } // WITNESS changeSPK → changeOut (spender-chosen; bound by the committedTxidP hash-match)
  e(LOCKTIME0, O.OP_CAT);                                           // ‖ nLockTime = txP
  e(O.OP_SHA256, O.OP_SHA256);                                      // hash256(txP)
  pick(committedAbs); e(O.OP_EQUALVERIFY);                          // == committedTxidP
  e(O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_FROMALTSTACK);       // [.., owner_type_in, owner_in, amount_in] (amount_in on top)
  return { ops, W };
}

// witness (deepest→top). outputs = [{ value, amountSer(8B), owner(20B), ownerType(0|1|2) }] for k=0..M'-1.
export function splitParentV2Witness({ committedTxidP, vin0Outpoint, changeVal, outputs }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const w = [committedTxidP, vin0Outpoint, u64(changeVal)];
  for (const o of outputs) w.push(u64(o.value), o.amountSer, o.owner, B(o.ownerType));
  return w;
}
