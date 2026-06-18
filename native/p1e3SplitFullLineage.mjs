// P2-5 LINEAGE v2 — the FULL composed split-child transfer leaf, MINUS the grandparent (Step 6a, the N9 "Layer 1" analog).
//
// Spends a SPLIT-child note (child j of a degree-M' split parent txP) and re-splits it into M new child notes. It welds the
// position-aware lineage onto the consensus-proven `splitFullOps` divisible-split leaf, replacing its THREE forgeable/free inputs:
//   • amount_in (the conservation target) — was a FREE witness register (parent-forgeable) → now BACKTRACE-PROVEN from txP's
//     stateOut_j (the kernel) and welded `CAT(8 tgt b_ser) == amount_in` (Step 5, the v2 CAT20 re-entry).
//   • c2 (shaPrevouts) — was SHA256(free outpoint) → now SHA256(committedTxidP ‖ u32le(2j)) (Step 4); 2j a per-leaf CONSTANT, and
//     the CSFS bind FORCES c2 == the real shaPrevouts ⟹ committedTxidP is the REAL parent txid + the note's REAL vout is 2j.
//   • owner_in (owner-auth target) — was a free witness → now BACKTRACE-PROVEN from txP's stateOut_j (the kernel parks it).
// Everything else is `splitFullOps` VERBATIM (PHASE B single-source amount_ser_j → stateOut_j/tokenOut_j → the M-way c6; PHASE A
// Σ children == target; PHASE C CSFS(computed)+CHECKSIG(real) + owner-auth hash160(P)==owner_in + the |P|/|sig| pins + cleanstack).
//
// Because c2 pins committedTxidP to the REAL parent, the kernel reads the REAL stateOut_j ⟹ amount_in/owner_in are the real
// parent's. The ONLY residual forge is "txP itself was an arbitrary tx paying ownSPK" (mint-from-nothing) — closed by the
// GRANDPARENT multi-shape (Step 6b, next): prove txP.vin0 spent a covenant note. ownSPK is WITNESS (c4-bound self-replication),
// the SAME item used to reconstruct txP's tokenOut_k and the current children's tokenOut_j. changeSPK + tokenId are leaf consts.
// scriptsim (CSFS structural: asserts the assembled message == the expected real sighash) dry-runs the byte-exact c2/c4/c6/message.
import * as bells from 'belcoinjs-lib';
import { splitParentReconstructOps } from './p1e3SplitLineage.mjs';
import { limbConsistencyVerifyOps } from './amounts.mjs';
import { FRAME } from './p1e3Const.mjs';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS, u32 } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

// Mp = parent split degree (the spent note is child j of txP); j = its position; M = current split degree; N = amount limbs (8).
export function splitFullLineageOps(Mp, j, M, N, { tokenId, changeSPK }) {
  if (!Number.isInteger(Mp) || Mp < 2 || Mp > 4) throw new Error(`M' (parent degree) must be 2..4: ${Mp}`);
  if (!Number.isInteger(j) || j < 0 || j >= Mp) throw new Error(`j must be 0..${Mp - 1}: ${j}`);
  if (!Number.isInteger(M) || M < 2 || M > 4) throw new Error(`M (current degree) must be 2..4: ${M}`);
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  const VTI = Buffer.concat([B(0x01), tokenId]), vsChange = Buffer.concat([B(0x22), changeSPK]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  const VOUT_LE = u32(2 * j);                                  // the spent note's vout (leaf const, Step 4)

  // ----- unified witness layout (deepest→top): the kernel's W_k items at the BOTTOM, then the epilogue + current-split items.
  const Wk = 3 + 3 * Mp;                                       // kernel witness: committedTxidP, vin0_outpoint, txP_changeVal, [v_k,a_k,o_k]
  const sigAbs = Wk + 0, pAbs = Wk + 1, c1Abs = Wk + 2, c3Abs = Wk + 3, c5Abs = Wk + 4, c7Abs = Wk + 5, c8Abs = Wk + 6, c9Abs = Wk + 7;
  const ownSpkAbs = Wk + 8, changeAbs = Wk + 9;
  const ownerAbs = (jj) => Wk + 10 + 2 * jj, valueAbs = (jj) => Wk + 10 + 2 * jj + 1;
  const childBase = Wk + 10 + 2 * M;
  const outNumAbs = (jj, i) => childBase + (jj * N + i) * 2, outSerAbs = (jj, i) => childBase + (jj * N + i) * 2 + 1;
  const tgtBase = childBase + 2 * M * N;
  const tgtNumAbs = (i) => tgtBase + 2 * i, tgtSerAbs = (i) => tgtBase + 2 * i + 1;
  const Wtotal = tgtBase + 2 * N;
  const committedAbs = 0;

  // ----- LINEAGE: reconstruct txP (witness ownSPK), park [owner_in, amount_in] on top.
  const { ops: kernelOps } = splitParentReconstructOps(Mp, j, { tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove: Wtotal - Wk, ownSpkAbs });
  const ops = [...kernelOps];
  const ownerInAbs = Wtotal, amountInAbs = Wtotal + 1;        // kernel pushes owner_in then amount_in (amount_in on top)
  let depth = Wtotal + 2;

  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_ADD]: -1, [O.OP_SUB]: -1,
    [O.OP_GREATERTHANOREQUAL]: -1, [O.OP_LESSTHAN]: -1, [O.OP_EQUAL]: -1, [O.OP_CHECKSIG]: -1,
    [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2, [OP_CSFS]: -2,
    [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_1ADD]: 0, [O.OP_NOT]: 0, [O.OP_HASH160]: 0, [O.OP_ROT]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const gadget = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF];
  const vsOwn = () => { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY); e(B(0x22), O.OP_SWAP, O.OP_CAT); }; // -> 0x22‖ownSPK on top

  // ----- STEP 5 weld — the conservation TARGET serializes to the backtrace-proven amount_in (else a forged target = inflation).
  e(O.OP_0);                                                  // amount_ser_target acc
  for (let i = 0; i < N; i++) { pick(tgtSerAbs(i)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); } // ‖ tgt_ser_i (|·|==1)
  e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);                     // |amount_ser_target| == N
  pick(amountInAbs); e(O.OP_EQUALVERIFY);                     // == amount_in (backtrace-proven)

  // ----- PHASE B — single-source amount_ser_j → stateOut_j/tokenOut_j → the c6 preimage (alt). VERBATIM from splitFullOps.
  e(O.OP_0, O.OP_TOALTSTACK);                                 // c6preimage = empty
  for (let jj = 0; jj < M; jj++) {
    e(O.OP_0);                                                // amount_ser_jj acc
    for (let i = 0; i < N; i++) { pick(outNumAbs(jj, i)); pick(outSerAbs(jj, i)); gadget(); pick(outSerAbs(jj, i)); e(O.OP_CAT); }
    e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                   // |amount_ser_jj|==8
    e(VTI, O.OP_SWAP, O.OP_CAT);                              // VTI ‖ amount_ser_jj
    pick(ownerAbs(jj)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); // -> stateOut_jj
    pick(valueAbs(jj)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); vsOwn(); e(O.OP_CAT); // tokenOut_jj = value_jj ‖ 0x22‖ownSPK ; [.., stateOut_jj, tokenOut_jj]
    e(O.OP_SWAP, O.OP_CAT);                                   // tokenOut_jj ‖ stateOut_jj = piece_jj
    e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // c6preimage ‖= piece_jj
  }
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, vsChange, O.OP_CAT); // changeOut = changeValue ‖ 0x22‖changeSPK
  e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);     // c6 = SHA256(c6preimage ‖ changeOut)

  // ----- PHASE A — conservation Σ(children) == target (= amount_in). VERBATIM from splitFullOps.
  e(O.OP_0, O.OP_TOALTSTACK);
  for (let i = 0; i < N; i++) {
    pick(tgtNumAbs(i)); pick(tgtSerAbs(i)); gadget();
    e(O.OP_FROMALTSTACK);
    for (let jj = 0; jj < M; jj++) { pick(outNumAbs(jj, i)); e(O.OP_ADD); }
    e(O.OP_0, O.OP_SWAP);
    for (let k = 0; k < M - 1; k++) ops.push(...reduceOne);
    if (i === N - 1) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY);
    pick(tgtNumAbs(i)); e(O.OP_NUMEQUALVERIFY);
    e(O.OP_TOALTSTACK);
  }
  e(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY);          // carry-out == 0 ; c6 on top

  // ----- PHASE C — bind c6 to the REAL sighash + owner-auth. c2 is the POSITION-AWARE Step-4 value (NOT a free outpoint).
  pick(ownSpkAbs); e(vsChange.subarray(1), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); // ownSPK != changeSPK (RED-3b on-chain)
  e(O.OP_TOALTSTACK);                                         // stash c6
  pick(c1Abs);                                                // c1
  pick(committedAbs); e(VOUT_LE, O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_SHA256, O.OP_CAT); // ‖ c2 = SHA256(committedTxidP ‖ u32le(2j))
  pick(c3Abs); e(O.OP_CAT);                                   // ‖ c3
  vsOwn(); e(O.OP_SHA256, O.OP_CAT);                          // ‖ c4 = SHA256(0x22‖ownSPK)
  pick(c5Abs); e(O.OP_CAT);                                   // ‖ c5  -> left = c1..c5
  e(O.OP_FROMALTSTACK, O.OP_CAT);                             // left ‖ c6
  pick(c7Abs); e(O.OP_CAT); pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT); // ‖ c7‖c8‖c9 = message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                // computed_sighash = SHA256(PREFIX ‖ message)
  pick(pAbs); pick(sigAbs); pins();                           // [computed, P, sig] ; |P|==32,|sig|==64
  e(O.OP_ROT, O.OP_ROT);                                      // -> [sig, computed, P]
  e(OP_CSFS, O.OP_VERIFY);                                    // CSFS: forces computed == real ⟹ c6 == real shaOutputs ∧ c2 == real shaPrevouts
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY); // CHECKSIG: sig over the REAL sighash under P
  pick(pAbs); e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY); // owner-auth: hash160(P) == backtrace-proven owner_in
  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);       // CLEANSTACK: drop all (witness + owner_in/amount_in leftovers)
  ops.push(O.OP_1);
  return { ops, Wk, Wtotal };
}
export const buildSplitFullLineageLeaf = (Mp, j, M, N, consts) => bells.script.compile(splitFullLineageOps(Mp, j, M, N, consts).ops);

// witness (deepest→top) matching the abs layout above.
//   parent: { committedTxidP, vin0Outpoint(36), changeVal, children: [{value, amountSer(8B), owner(20)}]_{M'} }  (txP reconstruction)
//   epi:    { sig(64), P(32), c1, c3, c5, c7, c8(leafHash), c9 }                                                   (sighash parts)
//   own:    ownSPK(34), changeValue                                                                                (current tx)
//   outs:   [{ owner(20), value, amount(bigint) }]_{M}                                                             (current children)
//   amountIn (bigint, the conservation target = the spent note's amount)
import { splitParentWitness } from './p1e3SplitLineage.mjs';
import { limbNum, limbSer, amountLimbsN } from './amounts.mjs';
export function splitFullLineageWitness({ parent, epi, ownSPK, changeValue, outs, amountIn, N = 8 }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const pairs = (v) => { const L = amountLimbsN(BigInt(v), N); const w = []; for (let i = 0; i < N; i++) w.push(limbNum(L[i]), limbSer(L[i])); return w; };
  const w = splitParentWitness(parent);                       // kernel region (bottom)
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue));
  for (const o of outs) w.push(o.owner, u64(o.value));        // [owner_j, value_j]
  for (const o of outs) w.push(...pairs(o.amount));           // [out_num_{j,i}, out_ser_{j,i}]
  w.push(...pairs(amountIn));                                 // [tgt_num_i, tgt_ser_i]
  return w;
}
