// P0b / P2-1a — the base-256 BYTE-LIMB amount primitives (the Phase-2 divisibility core). A uint64 token amount = 8 limbs in
// [0,255]. The v1 covenant proved conservation by 8-byte SERIALIZATION EQUALITY (mono-in/mono-out, no arithmetic); divisibility
// (split/merge) forces a DECLARED Σ(out)==Σ(in), i.e. real addition. An 8-byte blob can NEVER be a CScriptNum operand
// (`decode(8 bytes)` throws "Script number overflow"), so each limb carries a DUAL representation:
//   b_ser = the 1 wire byte (OP_CAT'd to reconstruct the sighash/state-bound 8-byte amount_ser),
//   b_num = the minimal CScriptNum operand (fed to OP_ADD for conservation),
// tied by a MANDATORY consistency gadget. That tie is THE CAT20 re-entry point: if it is ever loose, the summed value
// decouples from the bound serialization and the amount can be inflated while every byte-equality still passes (the 15-bit-
// limb scheme was rejected for exactly this). This module is the consistency gadget (P2-1a); the 8-limb adder (P2-1) composes it.
import * as bells from 'belcoinjs-lib';

const O = bells.opcodes;
const enc = bells.script.number.encode; // minimal CScriptNum: ''(0), 1 byte (1..127), 2 bytes w/ guard (128..255)
const B = (...x) => Buffer.from(x);

// THE per-limb consistency gadget (verify-only). Stack [.., b_num, b_ser] (b_ser on top) -> [..] iff (b_ser, b_num) encode
// the SAME value v in [0,255], else the script FAILS. CONSTRUCTIVE equality (GPT review round-1, both passes) — build the
// guard byte, never "strip" it (no OP_SUBSTR exists). MINIMALIF-clean (OP_LESSTHAN/OP_NUMEQUAL yield empty/0x01). A
// non-minimal or >4-byte b_num throws in OP_WITHIN/OP_LESSTHAN (consensus fRequireMinimal) -> reject.
export function limbConsistencyVerifyOps() {
  return [
    O.OP_SIZE, enc(1), O.OP_EQUALVERIFY,                  // |b_ser| == 1
    O.OP_SWAP,                                            // [.., b_ser, b_num]
    O.OP_DUP, O.OP_0, enc(256), O.OP_WITHIN, O.OP_VERIFY, // 0 <= b_num < 256
    O.OP_DUP, enc(128), O.OP_LESSTHAN,                    // b_num < 128 ?
    O.OP_IF,
      O.OP_DUP, O.OP_0, O.OP_NUMEQUAL,                    // b_num == 0 ?
      O.OP_IF,
        O.OP_DROP, B(0x00), O.OP_EQUALVERIFY,             // 0   -> b_ser == 0x00 (b_num is the empty push)
      O.OP_ELSE,
        O.OP_EQUALVERIFY,                                 // 1..127  -> b_ser == b_num (1-byte byte-equal)
      O.OP_ENDIF,
    O.OP_ELSE,
      O.OP_SWAP, B(0x00), O.OP_CAT, O.OP_EQUALVERIFY,     // 128..255 -> b_ser ‖ 0x00 == b_num (construct the guard byte)
    O.OP_ENDIF,
  ];
}

// canonical encodings for a limb value v in [0,255]
export function limbSer(v) { if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`limb out of range: ${v}`); return B(v); }
export function limbNum(v) { if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`limb out of range: ${v}`); return enc(v); }

// off-chain REFERENCE (the differential model, INDEPENDENT of the gadget): (b_ser, b_num) is consistent iff b_ser is one byte
// and b_num is the minimal CScriptNum of that byte's value. The consensus test asserts the gadget agrees with this reference.
export function limbConsistent(bSer, bNum) {
  if (!Buffer.isBuffer(bSer) || bSer.length !== 1) return false;
  if (!Buffer.isBuffer(bNum)) return false;
  return bNum.equals(enc(bSer[0]));
}

// the 8 base-256 limbs of a uint64 amount, LITTLE-ENDIAN (limb 0 = least significant) — matches the 8-byte LE amount_ser.
export function amountLimbs(v) {
  const x = typeof v === 'bigint' ? v : BigInt(v);
  if (x < 0n || x > (1n << 64n) - 1n) throw new Error(`amount out of range [0, 2^64): ${x}`);
  const limbs = [];
  for (let i = 0; i < 8; i++) limbs.push(Number((x >> BigInt(8 * i)) & 0xffn));
  return limbs; // [b0..b7], b0 = LSB
}

// ----- P2-1 the base-256 byte-limb ADDER -----
// Per-limb add macro. Invariant between limbs: alt = [serAcc, carry] (carry on top); main top has the next limb block
//   [a_i, b_i, s_num_i, s_ser_i] (s_ser_i on top), consumed LSB-first. Computes sum_i = a_i + b_i + carry, the carry-out, and
//   the result limb r_i = sum_i − 256·carryOut, asserts r_i == s_num_i (the supplied result NUM), appends s_ser_i to serAcc
//   (the result amount_ser), and threads carryOut as the next carry. `gateTop` (the MSB limb) also asserts r_i < 128 (amount
//   < 2^63). The supplied (s_num_i, s_ser_i) are tied by the consistency gadget ⟹ the summed value == the serialized value
//   (BIND, the CAT20 defense). sum_i ≤ 511 < 2^31 (a safe CScriptNum operand).
export function adderPerLimbOps(gateTop) {
  return [
    O.OP_2DUP, ...limbConsistencyVerifyOps(),               // STEP A: gadget-verify (s_num_i, s_ser_i), preserved
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_ROT, O.OP_CAT, O.OP_TOALTSTACK, // STEP B: serAcc ‖= s_ser_i (carry stays on main)
    O.OP_SWAP, O.OP_TOALTSTACK,                             // STEP C: stash s_num_i; main = [a_i, b_i, carry]
    O.OP_ADD, O.OP_ADD,                                     // sum_i = a_i + b_i + carry
    O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL,            // carryOut = sum_i >= 256
    O.OP_TUCK, O.OP_IF, enc(256), O.OP_SUB, O.OP_ENDIF,     // r_i = sum_i − 256·carryOut (carryOut kept below r_i)
    ...(gateTop ? [O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY] : []), // MSB limb: r_i < 128 ⟹ amount < 2^63
    O.OP_FROMALTSTACK, O.OP_NUMEQUALVERIFY,                 // r_i == s_num_i (BIND the summed value to the serialized one)
    O.OP_TOALTSTACK,                                        // carryOut -> the next carry
  ];
}

// The N-limb adder leaf (verify A + B == S over N base-256 limbs). Witness (deepest→top):
//   [committedSer, a_{N-1}, b_{N-1}, s_num_{N-1}, s_ser_{N-1}, ... , a_0, b_0, s_num_0, s_ser_0]
// where committedSer = the N-byte LE serialization of the sum. Succeeds iff: every result limb is gadget-consistent, the
// limb-wise add (with carry) matches the supplied result, the top-limb carry-out is 0 (no overflow past N bytes), the
// reconstructed amount_ser == committedSer, and (MSB limb) the sum < 2^(8N−1).
export function adderOps(N) {
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  const ops = [O.OP_0, O.OP_TOALTSTACK, O.OP_0, O.OP_TOALTSTACK]; // alt = [serAcc=empty, carry=0]
  for (let i = 0; i < N; i++) ops.push(...adderPerLimbOps(i === N - 1)); // LSB→MSB; MSB (last) gets the <2^(8N−1) gate
  ops.push(
    O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY,        // final carry-out == 0 (no overflow past N bytes)
    O.OP_FROMALTSTACK, O.OP_EQUALVERIFY,                   // reconstructed amount_ser == committedSer
    O.OP_1,
  );
  return ops;
}
export const buildAdderLeaf = (N) => bells.script.compile(adderOps(N));

// off-chain REFERENCE: base-256 limb-wise add with carry. aLimbs/bLimbs LSB-first; returns the N sum limbs + the carry-out.
export function addLimbsRef(aLimbs, bLimbs) {
  if (aLimbs.length !== bLimbs.length) throw new Error('limb count mismatch');
  const sumLimbs = []; let carry = 0;
  for (let i = 0; i < aLimbs.length; i++) { const s = aLimbs[i] + bLimbs[i] + carry; sumLimbs.push(s & 0xff); carry = s >= 256 ? 1 : 0; }
  return { sumLimbs, carryOut: carry };
}

// build the adder witness (deepest→top) for amounts a,b and their declared sum limbs.
export function adderWitness(aLimbs, bLimbs, sumLimbs) {
  const N = aLimbs.length;
  const w = [Buffer.from(sumLimbs)]; // committedSer (N-byte LE)
  for (let i = N - 1; i >= 0; i--) w.push(limbNum(aLimbs[i]), limbNum(bLimbs[i]), limbNum(sumLimbs[i]), limbSer(sumLimbs[i]));
  return w;
}

// ----- P2-1 (N-way) the SPLIT/MERGE conservation: Σ(M operand amounts) == target (the input), per-limb with a BOUNDED
//   multi-valued carry. Generalizes the 2-operand adder to a real split (1 note → M output notes) or merge (K → 1). Each
//   per-limb sum ≤ 255·M + carry < 2^31 (safe operand); the carry-out of a limb is ≤ M−1, extracted by ≤(M−1) unrolled
//   conditional 256-subtracts (no OP_DIV/MOD). The target limbs are gadget-tied (b_ser↔b_num) so the conserved value is
//   bound to the serialization (in the real leaf the operands are gadget-tied to their per-output stateOut, P2-2). -----
export function nwayConservationOps(M, N) {
  if (!Number.isInteger(M) || M < 2 || M > 16) throw new Error(`M must be 2..16: ${M}`);
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  const sumOne = [O.OP_SWAP, O.OP_DUP, O.OP_0, enc(256), O.OP_WITHIN, O.OP_VERIFY, O.OP_ADD]; // range-check an operand limb + add
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF];
  const perLimb = (gateTop) => {
    const ops = [
      O.OP_2DUP, ...limbConsistencyVerifyOps(),                 // gadget-verify (target_num, target_ser), preserved
      O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_ROT, O.OP_CAT, O.OP_TOALTSTACK, // serAcc ‖= target_ser (carry stays on main)
      O.OP_SWAP, O.OP_TOALTSTACK,                               // stash target_num; main = [.., out_0..out_{M-1}, carry]
    ];
    for (let j = 0; j < M; j++) ops.push(...sumOne);            // running = carry + Σ out_j (each ∈[0,255])
    ops.push(O.OP_0, O.OP_SWAP);                               // [carryOut=0, r=running]
    for (let k = 0; k < M - 1; k++) ops.push(...reduceOne);     // fully reduce: r<256, carryOut=floor(running/256)≤M−1
    if (gateTop) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY); // MSB: r<128 ⟹ amount < 2^(8N−1)
    ops.push(O.OP_FROMALTSTACK, O.OP_NUMEQUALVERIFY, O.OP_TOALTSTACK); // r == target_num ; carryOut -> next carry
    return ops;
  };
  const ops = [O.OP_0, O.OP_TOALTSTACK, O.OP_0, O.OP_TOALTSTACK]; // alt = [serAcc=empty, carry=0]
  for (let i = 0; i < N; i++) ops.push(...perLimb(i === N - 1));  // LSB→MSB
  ops.push(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY,        // final carry-out == 0 (Σ outputs == input, no overflow)
           O.OP_FROMALTSTACK, O.OP_EQUALVERIFY,                  // reconstructed input amount_ser == committedSer
           O.OP_1);
  return ops;
}
export const buildNwayLeaf = (M, N) => bells.script.compile(nwayConservationOps(M, N));

// off-chain REFERENCE + witness for the N-way conservation. `outs` = M output amounts (bigint); target = their sum.
export function nwayConservation(outs, N) {
  const target = outs.reduce((a, b) => a + BigInt(b), 0n);
  if (target >= (1n << BigInt(8 * N - 1))) throw new Error(`target ${target} >= 2^${8 * N - 1}`);
  return { target, targetLimbs: amountLimbsN(target, N) };
}
export function amountLimbsN(v, N) {
  const x = typeof v === 'bigint' ? v : BigInt(v);
  const a = []; for (let i = 0; i < N; i++) a.push(Number((x >> BigInt(8 * i)) & 0xffn)); return a;
}
// witness (deepest→top): [committedSer, block_{N-1}.., block_0], block_i = [out_0_i.., out_{M-1}_i, target_num_i, target_ser_i]
export function nwayWitness(outs, N, { targetOverride } = {}) {
  const M = outs.length;
  const outLimbs = outs.map((v) => amountLimbsN(v, N));
  const target = targetOverride !== undefined ? BigInt(targetOverride) : outs.reduce((a, b) => a + BigInt(b), 0n);
  const tLimbs = amountLimbsN(target, N);
  const w = [Buffer.from(tLimbs)]; // committedSer
  for (let i = N - 1; i >= 0; i--) {
    for (let j = 0; j < M; j++) w.push(limbNum(outLimbs[j][i]));
    w.push(limbNum(tLimbs[i]), limbSer(tLimbs[i]));
  }
  return w;
}

// ----- P2-MERGE the K=2 MERGE conservation: amt_self + amt_other == amount_out (uint64), base-256 byte-limbs, EVERY limb
//   gadget-tied. THE soundness crux vs adderOps / nwayConservationOps: those weld ONLY the sum/target serialization and leave
//   the OPERANDS free (range-checked). For a SPLIT that is fine — the operands are the M OUTPUTS, single-sourced to the c6
//   stateOuts. The MERGE INVERTS the roles: the two operands are the two BACKTRACE-PROVEN input amounts, so a free operand is a
//   mint-from-nothing (the attacker would pick the operands AND amount_out). Hence BOTH operands are welded here too:
//   OP_CAT(self_ser limbs)==amt_self_parked and OP_CAT(other_ser limbs)==amt_other_parked, with each limb's (num,ser) gadget-tied
//   so the b_num fed to OP_ADD is bound to the welded b_ser. The sum is welded to committedOut (the c6-bound amount_ser_out).
//   PICK-based (copies only) ⟹ leaves the stack UNCHANGED — a verify gadget the leaf drops into place after the two kernels park
//   amt_self/amt_other and the c6 phase exposes amount_ser_out. `base`/`startDepth` relocate it like the v2 kernel (default:
//   isolated, witness == the whole stack). Witness slice (deepest→top, abs from `base`):
//     amt_self(N) ‖ amt_other(N) ‖ committedOut(N) ‖ [ self_num_i, self_ser_i, other_num_i, other_ser_i, out_num_i, out_ser_i ]_{i=0..N-1}
//   (amt_*/committedOut are the N-byte LE serializations; for the uint64 token amount N=8). Asserts: every limb gadget-consistent;
//   the three serialization welds; the per-limb add self+other+carry==out with carry-out; final carry==0; MSB out limb < 128
//   (amount_out < 2^(8N-1) — load-bearing because a merge can modular-wrap, unlike a v1 mono transfer).
export function mergeConservationOps(N, { amtSelfAbs = 0, amtOtherAbs = 1, committedOutAbs = 2, blockBase = 3, startDepth = null } = {}) {
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  // The leaf PARKS amt_self/amt_other above the witness (non-adjacent — owner/owner_type sit between), while committedOut
  // (== amount_ser_out) and the limb blocks live in the witness — so the four anchors are passed as INDIVIDUAL abs positions.
  // Defaults reproduce the isolated contiguous layout [amt_self, amt_other, committedOut, blocks..] (the unit test).
  for (const [nm, v] of [['amtSelfAbs', amtSelfAbs], ['amtOtherAbs', amtOtherAbs], ['committedOutAbs', committedOutAbs], ['blockBase', blockBase]])
    if (!Number.isInteger(v) || v < 0) throw new Error(`${nm} must be a non-negative integer: ${v}`);
  if (startDepth !== null && (!Number.isInteger(startDepth) || startDepth < 0)) throw new Error(`startDepth must be null or a non-negative integer: ${startDepth}`);
  const bb = (i) => blockBase + 6 * i;
  const selfNumAbs = (i) => bb(i), selfSerAbs = (i) => bb(i) + 1, otherNumAbs = (i) => bb(i) + 2, otherSerAbs = (i) => bb(i) + 3, outNumAbs = (i) => bb(i) + 4, outSerAbs = (i) => bb(i) + 5;
  const W = 3 + 6 * N;
  const ops = []; let depth = startDepth ?? W;
  const DELTA = { [O.OP_0]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_ADD]: -1, [O.OP_CAT]: -1, [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const gadget = (numAbs, serAbs) => { pick(numAbs); pick(serAbs); ops.push(...limbConsistencyVerifyOps()); depth -= 2; }; // consumes the 2 picked copies
  const weld = (serAbsFn, parkedAbs) => {                              // OP_CAT(N ser limbs) == parked N-byte serialization
    e(O.OP_0);
    for (let i = 0; i < N; i++) { pick(serAbsFn(i)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); }
    e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);
    pick(parkedAbs); e(O.OP_EQUALVERIFY);
  };

  // (a) gadget-tie every limb (num↔ser) for self/other/out — PICK copies, witness untouched.
  for (let i = 0; i < N; i++) { gadget(selfNumAbs(i), selfSerAbs(i)); gadget(otherNumAbs(i), otherSerAbs(i)); gadget(outNumAbs(i), outSerAbs(i)); }
  // (b) serialization welds: operands == the parked backtraced amounts; the sum == committedOut (the c6-bound amount_ser_out).
  weld(selfSerAbs, amtSelfAbs);
  weld(otherSerAbs, amtOtherAbs);
  weld(outSerAbs, committedOutAbs);
  // (c)/(d)/(e) per-limb carry add: self_num + other_num + carry == out_num; carry threaded on the main top.
  e(O.OP_0);                                                          // carry = 0 (LSB-first)
  for (let i = 0; i < N; i++) {
    pick(selfNumAbs(i)); pick(otherNumAbs(i)); e(O.OP_ADD, O.OP_ADD);  // running = carry + self_i + other_i  (≤ 511 < 2^31)
    ops.push(O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_TUCK, O.OP_IF, enc(256), O.OP_SUB, O.OP_ENDIF); depth += 1; // -> [carryOut, r]
    if (i === N - 1) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY); // MSB limb: r < 128 ⟹ amount_out < 2^(8N-1) (net 0)
    pick(outNumAbs(i)); e(O.OP_NUMEQUALVERIFY);                        // r == out_num_i ; leaves [carryOut] as the next carry
  }
  e(O.OP_0, O.OP_NUMEQUALVERIFY);                                      // final carry-out == 0 (no overflow past N bytes)
  return { ops, W };
}
export const buildMergeConservationLeaf = (N) => bells.script.compile(mergeConservationOps(N).ops);

// off-chain REFERENCE + witness (deepest→top): amt_self(N) ‖ amt_other(N) ‖ committedOut(N) ‖
//   [self_num_i, self_ser_i, other_num_i, other_ser_i, out_num_i, out_ser_i]_{i=0..N-1}. `outOverride` forges amount_out (inflation RED).
export function mergeConservationWitness(amtSelf, amtOther, N, { outOverride } = {}) {
  const serN = (v) => Buffer.from(amountLimbsN(v, N));
  const out = outOverride !== undefined ? BigInt(outOverride) : BigInt(amtSelf) + BigInt(amtOther);
  const sS = amountLimbsN(amtSelf, N), sO = amountLimbsN(amtOther, N), sU = amountLimbsN(out, N);
  const w = [serN(amtSelf), serN(amtOther), serN(out)];
  for (let i = 0; i < N; i++) w.push(limbNum(sS[i]), limbSer(sS[i]), limbNum(sO[i]), limbSer(sO[i]), limbNum(sU[i]), limbSer(sU[i]));
  return w;
}
