// P2-MERGE brick 2b — the K=2 MERGE leaf (v2, KEY-only, single-owner, tight cap). Spends TWO transfer-note inputs (each a 1→1
// child @ vout0, the tight-cap canonical shape) and emits ONE note carrying amount_self + amount_other. A merge tx is 2-input ⟹
// TWO leaf-instance executions (one per vin, at inIndex = side); each is a COMPLETE conservation proof (dual-backtrace): it
// reconstructs BOTH parents and asserts amount_out == amt_self + amt_other (a free partner amount = mint-from-nothing — see
// merge_conservation.test.mjs). The two instances share only the sighash-bound c2 (both outpoints) and c6 (the single output).
//
// ⚠️ STAGING (step 2b-1): this composes the kernels + the proven mergeConservationOps + the single-output c6 + the 2-input
// baked-c7 epilogue + the KEY-only gates, with a VALID 2-input sighash. It does NOT yet attach the depth-2 GRANDPARENT arms
// (step 2b-2: a transfer-grandparent prefix per kernel, so each input's lineage closes to genesis). Until then this leaf proves
// the COMPOSITION mechanics, NOT lineage soundness (a fabricated parent would pass) — exactly the C-1 lesson. NOT freeze-ready.
//
// side ∈ {0,1} is a leaf CONSTANT (the c2 CAT order + the baked c7 inIndex differ ⟹ two leaves, un-shareable). Tight cap ⟹ both
// inputs are at vout0 of their parents (VOUT0_LE), and both parents are degree-1 (Mp=1) transfers reconstructed by the kernel.
import * as bells from 'belcoinjs-lib';
import { splitParentReconstructV2Ops, splitParentV2Witness } from './p1e3SplitLineageV2.mjs';
import { splitGrandparentTransferV2PrefixOps, transferGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { mergeConservationOps, mergeConservationWitness } from './amounts.mjs';
import { FRAME } from './p1e3Const.mjs';
import { STATE_V2_PREFIX, OwnerType } from './wire.mjs';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS, u32 } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);
const N = 8;                                   // uint64 token amount = 8 base-256 limbs
const Mp = 1, j = 0;                           // tight cap: each input's parent is a degree-1 (1→1) transfer, spent child @ vout0

export function mergeK2V2Ops(side, { tokenId, changeSPK, changeWitness = false }) {
  if (side !== 0 && side !== 1) throw new Error(`side must be 0 or 1: ${side}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  // ownSPK is NOT a const here — it is the transferSPK (= f(root), circular), read from the WITNESS (ownSpkAbs) like every other leaf.
  const CW = changeWitness === true;                                 // BRICK 2: spender-chosen change everywhere (else a baked addr = centralization)
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  const VOUT0_LE = u32(0);                                            // both inputs are at vout0 (tight cap)
  const C7 = Buffer.concat([B(0x02), u32(side)]);                     // c7 = spendType(no-annex) ‖ inIndex==side, BAKED

  const Wk = 3 + 4 * Mp;                                              // = 7 per kernel slice
  const committedSelfAbs = 0, committedOtherAbs = Wk;                 // each kernel's committedTxidP @ base+0
  // witness layout (deepest→top), abs:
  //   [0..6]  KERNEL_SELF slice    [7..13] KERNEL_OTHER slice
  const sigAbs = 2 * Wk, pAbs = 2 * Wk + 1, c1Abs = 2 * Wk + 2, c3Abs = 2 * Wk + 3, c5Abs = 2 * Wk + 4, c8Abs = 2 * Wk + 5, c9Abs = 2 * Wk + 6;
  const ownSpkAbs = 2 * Wk + 7, changeAbs = 2 * Wk + 8, ownerOutAbs = 2 * Wk + 9, valueOutAbs = 2 * Wk + 10, amountSerOutAbs = 2 * Wk + 11;
  const blockBase = 2 * Wk + 12;                                      // the 6N conservation limb items
  const Wtotal = blockBase + 6 * N;                                   // = 74 (the body witness, no CW)
  // changeWitness: 3 spender-chosen change SPKs ABOVE the body (the current merge tx + the two input parents' changes; the two
  // grandparents' changes are already witness via tailGP). Absent ⟹ baked const ⟹ byte-identical to the pre-CW leaf.
  const curChangeSpkAbs = Wtotal, parSelfChangeSpkAbs = Wtotal + 1, parOtherChangeSpkAbs = Wtotal + 2;
  const Wtotal_eff = Wtotal + (CW ? 3 : 0);
  // parked registers @ Wtotal_eff (above the CW fields): self [ot,owner,amt], then other.
  const otSelfAbs = Wtotal_eff + 0, ownerSelfAbs = Wtotal_eff + 1, amtSelfAbs = Wtotal_eff + 2;
  const otOtherAbs = Wtotal_eff + 3, ownerOtherAbs = Wtotal_eff + 4, amtOtherAbs = Wtotal_eff + 5;

  // KERNEL_SELF @ base 0 (height == Wtotal_eff); KERNEL_OTHER @ base Wk (SELF parked 3 ⟹ height Wtotal_eff+3). Each parent's change is
  // witness (parSelf/parOther) under CW.
  // ownSPK is the transferSPK (= f(the taptree root)) ⟹ CANNOT be baked into a leaf (circular). Both kernels read it from the WITNESS
  // (ownSpkAbs @ 2·Wk+7, shared) — c4 binds that witness ownSPK to both real input SPKs, so the reconstructed parent tokenOut == the input.
  const kSelf = splitParentReconstructV2Ops(Mp, j, { tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove: Wtotal_eff - Wk, ownSpkAbs, changeSpkAbs: CW ? parSelfChangeSpkAbs : null });
  const kOther = splitParentReconstructV2Ops(Mp, j, { tokenId, ownSPK: Buffer.alloc(34), changeSPK, base: Wk, startDepth: Wtotal_eff + 3, ownSpkAbs, changeSpkAbs: CW ? parOtherChangeSpkAbs : null });
  if (kSelf.W !== Wk || kOther.W !== Wk) throw new Error('kernel W mismatch — offset corruption');
  const ops = [...kSelf.ops, ...kOther.ops];
  let depth = Wtotal_eff + 6;

  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_2DUP]: 2, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_EQUAL]: -1, [O.OP_CHECKSIG]: -1,
    [O.OP_EQUALVERIFY]: -2, [OP_CSFS]: -2, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_NOT]: 0, [O.OP_HASH160]: 0, [O.OP_ROT]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };
  const vsOwn = () => { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY); e(B(0x22), O.OP_SWAP, O.OP_CAT); }; // -> varslice(ownSPK)

  // (1) CONSERVATION (the keystone): amount_ser_out == amt_self + amt_other, operands welded to the backtrace-parked amounts,
  //     the sum single-sourced to amount_ser_out (which the c6 below commits). A VERIFY gadget — leaves the stack unchanged.
  ops.push(...mergeConservationOps(N, { amtSelfAbs, amtOtherAbs, committedOutAbs: amountSerOutAbs, blockBase, startDepth: depth }).ops);

  // (2) c6 = SHA256( tokenOut0 ‖ stateOut0 ‖ changeOut ), single output, owner_type_out BAKED = KEY (merge can only emit KEY notes).
  pick(valueOutAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); vsOwn(); e(O.OP_CAT);                 // tokenOut0 = value_out ‖ 0x22‖ownSPK
  e(Buffer.concat([STATE_V2_PREFIX, B(OwnerType.KEY)]));                                           // 0x02 ‖ owner_type_out(KEY) [baked]
  e(tokenId, O.OP_CAT);                                                                            // ‖ token_id
  pick(amountSerOutAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);                          // ‖ amount_ser_out (the conserved sum)
  pick(ownerOutAbs); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); // -> stateOut0
  e(O.OP_CAT);                                                                                     // tokenOut0 ‖ stateOut0
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                                          // changeVal pinned
  if (CW) { pick(curChangeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT); } // ‖ changeOut (witness changeSPK)
  else e(vsChange, O.OP_CAT);                                                                       // ‖ changeOut (const changeSPK)
  e(O.OP_CAT, O.OP_SHA256);                                                                        // c6 = sha_outputs (3-output)
  if (CW) { pick(ownSpkAbs); pick(curChangeSpkAbs); e(O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); }         // ownSPK != changeSPK (witness)
  else { pick(ownSpkAbs); e(vsChange.subarray(1), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); }             // ownSPK != changeSPK (const)
  e(O.OP_TOALTSTACK);                                                                              // stash c6

  // (3) EPILOGUE (2-input): rebuild the sighash message = PREFIX ‖ c1‖c2‖c3‖c4‖c5‖c6‖c7‖c8‖c9, bind via CSFS(computed==real)+CHECKSIG.
  pick(c1Abs);                                                                                     // c1
  pick(committedSelfAbs); e(VOUT0_LE, O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY);              // outpoint_self
  pick(committedOtherAbs); e(VOUT0_LE, O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY);             // outpoint_other
  e(O.OP_2DUP, O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY);                                                  // dup-prevout guard: outpoint_self != outpoint_other
  if (side === 1) e(O.OP_SWAP);                                                                     // side0: self‖other ; side1: other‖self
  e(O.OP_CAT, O.OP_SHA256, O.OP_CAT);                                                               // ‖ c2 = SHA256(outpoint_e0 ‖ outpoint_e1)
  pick(c3Abs); e(O.OP_CAT);                                                                         // ‖ c3 (shaAmounts, witness-bound)
  vsOwn(); vsOwn(); e(O.OP_CAT, O.OP_SHA256, O.OP_CAT);                                              // ‖ c4 = SHA256(varslice(ownSPK)‖varslice(ownSPK)) — vinCount==2 ∧ both covenant
  pick(c5Abs); e(O.OP_CAT);                                                                         // ‖ c5 (shaSequences)
  e(O.OP_FROMALTSTACK, O.OP_CAT);                                                                   // ‖ c6
  e(C7, O.OP_CAT);                                                                                  // ‖ c7 (baked: no-annex, inIndex==side)
  pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT);                                               // ‖ c8 ‖ c9
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                                                      // computed_sighash = SHA256(PREFIX ‖ message)
  pick(pAbs); pick(sigAbs); pins();
  e(O.OP_ROT, O.OP_ROT, OP_CSFS, O.OP_VERIFY);                                                      // CSFS: computed == real
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY);                                // CHECKSIG over the real sighash

  // (4) KEY-only + single-owner gates (op-level invariants; each instance backtraced BOTH inputs so all anchors are local).
  pick(otSelfAbs); e(B(OwnerType.KEY), O.OP_EQUALVERIFY);                                           // owner_type_in_self == KEY
  pick(otOtherAbs); e(B(OwnerType.KEY), O.OP_EQUALVERIFY);                                          // owner_type_in_other == KEY
  pick(pAbs); e(O.OP_HASH160); pick(ownerSelfAbs); e(O.OP_EQUALVERIFY);                             // hash160(P) == owner_in_self (auth)
  pick(ownerOutAbs); pick(ownerSelfAbs); e(O.OP_EQUALVERIFY);                                       // owner_out == owner_in_self
  pick(ownerOutAbs); pick(ownerOtherAbs); e(O.OP_EQUALVERIFY);                                      // owner_out == owner_in_other (single-owner)

  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);
  ops.push(O.OP_1);
  return { ops, Wtotal: Wtotal_eff };
}
export const buildMergeK2V2Leaf = (side, consts) => bells.script.compile(mergeK2V2Ops(side, consts).ops);

// ----- FULL merge leaf with DEPTH-2 LINEAGE (step 2b-2): a TRANSFER-grandparent arm per input (tight cap ⟹ both grandparents are
//   1→1 transfers). Each arm reconstructs txGP_k and forces hash256(txGP_k)‖vout0 == txP_k.vin0 (the kernel's vin0 @ abs 1 for self,
//   @ abs Wk+1 for other), then DROPs its 6 pieces — so the merge BODY runs verbatim at Wtotal_body. This closes the C-1 lineage gap
//   (a fabricated parent now rejects). GP_SELF sits on top (runs first), GP_OTHER below; the body witness is at the bottom.
export function mergeK2V2LineageOps(side, consts) {
  const body = mergeK2V2Ops(side, consts);
  const Wbody = body.Wtotal;                                          // = Wtotal_eff (74, or 77 with changeWitness)
  const Wk = 3 + 4 * Mp;                                              // kernel slice width (= 7); Wk is local to mergeK2V2Ops, recompute here
  const Pn = 6;                                                       // transfer-gp pieces per arm
  const ownSpkAbs = 2 * Wk + 7;                                       // the body's ownSPK position (= 21)
  const vin0SelfAbs = 1, vin0OtherAbs = Wk + 1;                       // the two kernels' txP.vin0 (= 1, 8)
  // GP_SELF: pieces @ [Wbody+Pn .. Wbody+2Pn-1] (top); GP_OTHER: pieces @ [Wbody .. Wbody+Pn-1]. Each prefix DROPs its own Pn.
  const gpSelf = splitGrandparentTransferV2PrefixOps(Mp, j, 2, N, { tokenId: consts.tokenId, leafWtotal: Wbody, loc: { vin0Abs: vin0SelfAbs, ownSpkAbs, gpBase: Wbody + Pn, startDepth: Wbody + 2 * Pn } });
  const gpOther = splitGrandparentTransferV2PrefixOps(Mp, j, 2, N, { tokenId: consts.tokenId, leafWtotal: Wbody, loc: { vin0Abs: vin0OtherAbs, ownSpkAbs, gpBase: Wbody, startDepth: Wbody + Pn } });
  return { ops: [...gpSelf.ops, ...gpOther.ops, ...body.ops], Wtotal: Wbody + 2 * Pn };
}
export const buildMergeK2V2LineageLeaf = (side, consts) => bells.script.compile(mergeK2V2LineageOps(side, consts).ops);

// FULL-lineage witness = body witness ‖ GP_OTHER pieces ‖ GP_SELF pieces. gpSelf/gpOther = transferGrandparentV2 args (each describes
// the 1→1 grandparent tx: gpVin0Outpoint, valGP, ownerGP, amtGP, ownerTypeGP, tailGP). The body's parent.vin0Outpoint MUST equal
// hash256(transferGrandparentV2(gp).txGP) ‖ u32le(0) or the arm's EQUALVERIFY rejects.
export function mergeK2V2LineageWitness({ gpSelf, gpOther, ...bodyArgs }) {
  const bodyW = mergeK2V2Witness(bodyArgs);
  const piecesSelf = transferGrandparentV2(gpSelf).pieces;
  const piecesOther = transferGrandparentV2(gpOther).pieces;
  return [...bodyW, ...piecesOther, ...piecesSelf];                   // GP_OTHER below GP_SELF (GP_SELF runs first, pieces on top)
}

// witness (deepest→top): KERNEL_SELF slice ‖ KERNEL_OTHER slice ‖ sig,P,c1,c3,c5,c8,c9 ‖ ownSPK,changeValue,owner_out,value_out,
//   amount_ser_out ‖ [self_num_i,self_ser_i,other_num_i,other_ser_i,out_num_i,out_ser_i]_{i=0..N-1}.
export function mergeK2V2Witness({ parentSelf, parentOther, epi, ownSPK, changeValue, ownerOut, valueOut, amtSelf, amtOther, outOverride, cw }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const out = outOverride !== undefined ? BigInt(outOverride) : BigInt(amtSelf) + BigInt(amtOther);
  const w = [...splitParentV2Witness(parentSelf), ...splitParentV2Witness(parentOther)];
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c8, epi.c9, ownSPK, u64(changeValue), ownerOut, u64(valueOut), u64(out));
  w.push(...mergeConservationWitness(amtSelf, amtOther, N, { outOverride }).slice(3)); // drop the [amt_self,amt_other,committedOut] prefix; keep the 6N blocks
  if (cw) w.push(cw.curChangeSpk, cw.parSelfChangeSpk, cw.parOtherChangeSpk);          // changeWitness: 3 spender-chosen change SPKs above the body
  return w;
}
