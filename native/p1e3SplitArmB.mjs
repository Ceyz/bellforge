// P2-5 LINEAGE v2 — ARM B (split-child spend), Steps 4 + 5: the position-binding c2 + the conservation-target weld.
//
// This sits on top of the proven enumeration kernel (splitParentReconstructOps). The kernel rebuilds the split parent txP of
// degree M', proves hash256(txP)==committedTxidP, and PARKS the spent note's (amount_in, owner_in) from stateOut_j @ vout 2j+1.
// Arm B then closes the two 🔴 MANDATORY welds the lineage-v2 design flagged as the v2 CAT20/forgery re-entry points:
//
//   STEP 4 (position binding) — c2 = SHA256( committedTxidP ‖ u32le(2j) ). The spent note is tokenOut_j @ vout 2j of txP, so its
//     outpoint is (committedTxidP, 2j). 2j is a PER-LEAF CONSTANT (one child-spend tapleaf per position j). The CSFS epilogue
//     (Step 6) forces c2 == the real shaPrevouts ⟹ a leaf for position j' ≠ j can never spend child j (c2 mismatch → reject).
//     Until the kernel proves committedTxidP via hash256, this would be forgeable; because it does, c2 binds the REAL parent+vout.
//
//   STEP 5 (conservation seam) — do NOT reuse splitFullOps' FREE-witness amount_in (parent-forgeable). After the kernel parks the
//     BACKTRACE-PROVEN amount_in, re-witness the N target b_ser limbs, OP_CAT them (each |·|==1) into an N-byte amount_ser_target,
//     and OP_EQUALVERIFY it == amount_in. THEN (Step 6) those same limbs gadget-tie + feed PHASE A (Σ children == target). Without
//     this seam a forged free target would let conservation pass while each child stateOut commits the real share = inflation.
//
// Leaves c2 on the main-stack TOP (the epilogue binds it; the scriptsim test reads it). amount_in/owner_in remain below c2.
// Run the op array through scriptsim before regtest. N defaults to 8 (full uint64).
import * as bells from 'belcoinjs-lib';
import { splitParentReconstructOps, splitParentWitness } from './p1e3SplitLineage.mjs';
import { limbNum, limbSer, amountLimbsN } from './amounts.mjs';
import { u32 } from './sighashParts.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;

// arm-B ops for split degree M' (the PARENT degree) and spent-child position j, N amount limbs. Composes the kernel (with
// extraAbove = 2N for the target-limb witness) then Steps 4 + 5.
export function splitArmBOps(M, j, { tokenId, ownSPK, changeSPK }, N = 8) {
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  const VOUT_LE = u32(2 * j);                              // the spent note's vout = 2j (leaf constant, 4B LE)

  // STEP 0 — the enumeration kernel. extraAbove = 2N (the target-limb pairs stacked above the kernel witness).
  const { ops: kernelOps, W } = splitParentReconstructOps(M, j, { tokenId, ownSPK, changeSPK, extraAbove: 2 * N });
  const ops = [...kernelOps];                              // post-kernel: [ kwitness(W) , twitness(2N) , owner_in , amount_in ]

  // absolute witness positions (from the stack bottom). twitness region sits directly above the kernel's W items.
  const committedAbs = 0;
  const tgtSerAbs = (i) => W + 2 * i + 1;                  // target limb i: [num @ W+2i, ser @ W+2i+1]
  const ownerInAbs = W + 2 * N;                            // pushed by the kernel (FROMALTSTACK)
  const amountInAbs = W + 2 * N + 1;
  let depth = W + 2 * N + 2;                               // kernel net main effect = +2 (owner_in, amount_in)

  const DELTA = {
    [O.OP_0]: 1, [O.OP_SIZE]: 1, [O.OP_EQUALVERIFY]: -2, [O.OP_CAT]: -1, [O.OP_SHA256]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  // STEP 5 — conservation-target weld: amount_ser_target = ‖ tgt_ser_i (LSB→MSB) ; == backtrace-proven amount_in.
  e(O.OP_0);                                               // acc = empty
  for (let i = 0; i < N; i++) { pick(tgtSerAbs(i)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); } // ‖ tgt_ser_i (|·|==1)
  e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);                  // |amount_ser_target| == N
  pick(amountInAbs); e(O.OP_EQUALVERIFY);                  // amount_ser_target == amount_in (the seam; forged target → reject)

  // STEP 4 — c2 = SHA256(committedTxidP ‖ VOUT_LE). committedTxidP is 32B (kernel hash-proof) + VOUT_LE 4B ⟹ outpoint 36B.
  pick(committedAbs); e(VOUT_LE);                          // [.., committedTxidP, VOUT_LE]
  e(O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_SHA256); // c2 (|outpoint|==36 pinned for audit clarity)

  return { ops, W, N };
}

// witness (deepest→top) for splitArmBOps: the kernel witness ‖ the N target limb pairs [num_i, ser_i]_{i=0..N-1}.
// targetAmount = the conservation target (= amount_in for a GREEN spend; override it to forge the Step-5 RED).
export function splitArmBWitness({ committedTxidP, vin0Outpoint, changeVal, outputs, targetAmount, N = 8 }) {
  const w = splitParentWitness({ committedTxidP, vin0Outpoint, changeVal, outputs });
  const tl = amountLimbsN(BigInt(targetAmount), N);
  for (let i = 0; i < N; i++) w.push(limbNum(tl[i]), limbSer(tl[i]));
  return w;
}
