// P2-5 LINEAGE v2 (position-aware) — the FULL-PARENT-ENUMERATION kernel. The spent note is tokenOut_j @ vout 2j of a split
// parent txP of degree M'. This rebuilds ALL 2M'+1 outputs of txP left-to-right from OP_SIZE-pinned sub-fields (so the needle
// offset is a DERIVED SUM of pinned widths — max witness item 36B, NO chunking, H2 closure STRUCTURAL), proves
// hash256(txP)==committedTxidP, and PARKS the spent note's (amount_in, owner_in) from stateOut_j (the position-aware backtrace
// that replaces the mini split leaf's FREE-witness amount_in). j and M' are per-leaf CONSTANTS (a tapleaf per child position).
// Designed via the lineage-v2 workflow (winner over the pinned-blob design, which a re-chunk could slide). Consts MEASURED in
// p1e3SplitConst.mjs / p1e3_split_const.test.mjs.
import * as bells from 'belcoinjs-lib';
import { FRAME } from './p1e3Const.mjs';
import { HDR_S, splitMid, LOCKTIME0 } from './p1e3SplitConst.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

// reconstruct txP (split parent, degree M') and park (amount_in, owner_in) from the spent note's stateOut_j. ownSPK/changeSPK
// are leaf consts here (in the full leaf ownSPK is the witness self-replication target bound by c4). Leaves the running acc
// consumed; pushes [.., owner_in, amount_in] (amount_in on top). committedTxidP is hash-checked, NOT left.
// witness (deepest→top): committedTxidP(32) ‖ vin0_outpoint(36) ‖ changeVal(8) ‖ [ value_k(8) ‖ amount_k(8) ‖ owner_k(20) ]_{k=0..M'-1}
// COMPOSITION: `extraAbove` = the count of witness items stacked ABOVE this kernel's W items (e.g. arm B's target-limb pairs and
// the full-leaf epilogue witness). The kernel's abs indices stay 0..W-1 (its items at the stack BOTTOM); only the starting depth
// is offset so the OP_PICK literals reach down past the extra items. Default 0 ⟹ identical to the standalone kernel.
// `ownSpkAbs` (composition): when null, ownSPK is a LEAF CONSTANT (the standalone kernel — its own tests). When a witness abs,
// ownSPK is taken from witness[ownSpkAbs] (|·|==34 pinned) and the SAME witness item is what the full leaf's c4=SHA256(0x22‖ownSPK)
// binds to the real input SPK — the covenant can NOT bake its own Taproot SPK as a const (address loop), so the composed leaf
// MUST reconstruct txP's tokenOut_k from the c4-bound witness ownSPK. `ownSPK` is still passed (for length validation only when const).
export function splitParentReconstructOps(M, j, { tokenId, ownSPK, changeSPK, extraAbove = 0, ownSpkAbs = null }) {
  if (!Number.isInteger(M) || M < 2 || M > 4) throw new Error(`M' must be 2..4 (M_MAX=4): ${M}`);
  if (!Number.isInteger(j) || j < 0 || j >= M) throw new Error(`j must be 0..${M - 1}: ${j}`);
  if (!Number.isInteger(extraAbove) || extraAbove < 0) throw new Error(`extraAbove must be a non-negative integer: ${extraAbove}`);
  if (ownSpkAbs !== null && (!Number.isInteger(ownSpkAbs) || ownSpkAbs < 0)) throw new Error(`ownSpkAbs must be null or a non-negative integer: ${ownSpkAbs}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(ownSPK) || ownSPK.length !== 34) throw new Error('ownSPK must be 34B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B (FUND-CRITICAL: non-34B change ⟹ unspendable children)');
  const VTI = Buffer.concat([B(0x01), tokenId]);          // state v1 prefix (v2 migration is a separate step)
  const vsOwn = Buffer.concat([B(0x22), ownSPK]);
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const SPLIT_MID = splitMid(M);                          // VINTAIL ‖ voutCount(2M+1) — the parent-degree discriminator
  const committedAbs = 0, vin0Abs = 1, changeValAbs = 2;
  const valueAbs = (k) => 3 + 3 * k, amountAbs = (k) => 3 + 3 * k + 1, ownerAbs = (k) => 3 + 3 * k + 2;
  const W = 3 + 3 * M;

  const ops = []; let depth = W + extraAbove;
  const DELTA = {
    [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0,
    [O.OP_EQUALVERIFY]: -2,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  e(HDR_S);                                               // acc = HDR_S (5B: version ‖ vinCount)
  pick(vin0Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT); // acc ‖ vin0_outpoint (the grandparent pointer, |·|==36)
  e(SPLIT_MID, O.OP_CAT);                                 // acc ‖ scriptSigLen‖seq‖voutCount(2M+1)
  for (let k = 0; k < M; k++) {
    pick(valueAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                            // value_k pinned
    if (ownSpkAbs === null) e(vsOwn, O.OP_CAT, O.OP_CAT);                                 // const: ‖ 0x22‖ownSPK -> tokenOut_k
    else { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); } // witness ownSPK: build 0x22‖ownSPK -> tokenOut_k
    e(VTI); pick(amountAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);          // VTI ‖ amount_k
    pick(ownerAbs(k)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);     // SHA256(state_k)
    e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);              // ‖ stateOut_k = FRAME ‖ SHA256(state_k)
    if (k === j) { pick(amountAbs(k)); e(O.OP_TOALTSTACK); pick(ownerAbs(k)); e(O.OP_TOALTSTACK); } // PARK amount_in, owner_in
  }
  pick(changeValAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT, O.OP_CAT); // ‖ changeOut = changeVal ‖ 0x22‖changeSPK
  e(LOCKTIME0, O.OP_CAT);                                 // ‖ nLockTime = txP
  e(O.OP_SHA256, O.OP_SHA256);                            // hash256(txP)
  pick(committedAbs); e(O.OP_EQUALVERIFY);                // == committedTxidP (forces txP = the REAL parent ⟹ amount_in/owner_in real)
  e(O.OP_FROMALTSTACK, O.OP_FROMALTSTACK);                // [.., owner_in, amount_in]
  return { ops, W };
}

// witness (deepest→top) for the kernel. outputs = [{ value, amountSer(8B), owner(20B) }] for k=0..M'-1.
export function splitParentWitness({ committedTxidP, vin0Outpoint, changeVal, outputs }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const w = [committedTxidP, vin0Outpoint, u64(changeVal)];
  for (const o of outputs) w.push(u64(o.value), o.amountSer, o.owner);
  return w;
}
