// EMULATED MULTIPLICATION — the base `chunkMul` gadget (no OP_MUL on Bellscoin). Multiply `a` (a CScriptNum, ≤2^16) × `b` (a
// byte) via WITNESS-bit shift-and-add. The 8 bits of `b` are spender-supplied + VERIFIED (BIND-not-DECLARE): the gadget rebuilds
// `Σ bit_k·2^k` (doubling = x+x, conditional via OP_IF) and asserts it == b, so a forged bit-decomposition is rejected. Then the
// product = `Σ (a·2^k)·bit_k`. Every intermediate stays a SAFE CScriptNum operand: a·2^7 ≤ 65535·128 = 8.39M < 2^31. The gadget is
// radix-AGNOSTIC (a is a CScriptNum whether it's a uint8 or uint16 limb) — the 8×8 vs 16×8 radix decision is a `mulN`-level choice
// (32 vs 64 chunkMuls), measured later. Design + the GPT-pass-1 corrections (MINIMALIF, radix): docs/MUL_GADGET_DESIGN.md.
import * as bells from 'belcoinjs-lib';
import { limbConsistencyVerifyOps } from './amounts.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;     // minimal CScriptNum
const B = (...x) => Buffer.from(x);

// off-chain REFERENCE (the differential model the scriptsim is checked against).
export const chunkMulRef = (a, b) => a * b;
// the 8 bits of byte b (LSB first), each a MINIMAL CScriptNum push: '' (empty) for 0, 0x01 for 1 — MINIMALIF-clean as IF selectors.
export function bitsOf(b) {
  if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`b must be a byte [0,255]: ${b}`);
  const out = [];
  for (let k = 0; k < 8; k++) out.push((b >> k) & 1 ? B(0x01) : Buffer.alloc(0));
  return out;
}

// chunkMulOps — stack (deepest→top): a, b, bit_0, …, bit_7  (10 items). Verifies Σ bit_k·2^k == b (bits ∈{'',0x01}, MINIMALIF) and
// leaves EXACTLY [a·b] (consumes the 10 inputs). The accumulator lives on the ALT stack so the main stack stays free for the
// doubling; the inputs are read non-destructively via OP_PICK (fixed abs positions) then dropped at the end.
export function chunkMulOps() {
  const aAbs = 0, bAbs = 1, bitAbs = (k) => 2 + k;
  const ops = []; let depth = 10;
  const DELTA = {
    [O.OP_ADD]: -1, [O.OP_DROP]: -1, [O.OP_DUP]: 1, [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_OVER]: 1, [O.OP_SWAP]: 0,
    [O.OP_VERIFY]: -1, [O.OP_NUMEQUALVERIFY]: -2, [O.OP_WITHIN]: -2, [O.OP_TOALTSTACK]: -1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_IF]: -1, [O.OP_ENDIF]: 0,      // OP_IF pops the (taken) selector; the body below is net-0 ⟹ post-ENDIF depth is correct
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  // ----- STEP 1: verify the witnessed bits reconstruct b (Σ bit_k·2^k == b). accumulator bacc on alt, pow=2^k on main top. -----
  e(O.OP_0, O.OP_TOALTSTACK);                 // bacc = 0 (alt)
  e(O.OP_1);                                  // pow = 2^0 = 1 (main top)
  for (let k = 0; k < 8; k++) {
    pick(bitAbs(k));                          // bit_k
    e(O.OP_DUP, O.OP_0, enc(2), O.OP_WITHIN, O.OP_VERIFY);  // 0 <= bit_k < 2 (minimal ⟹ '' or 0x01); leaves bit_k
    e(O.OP_IF);                               // taken iff bit_k == 1
      e(O.OP_FROMALTSTACK);                   // bacc
      e(O.OP_OVER);                           // copy pow (2nd from top)
      e(O.OP_ADD);                            // bacc + pow
      e(O.OP_TOALTSTACK);                     // bacc += pow
    e(O.OP_ENDIF);
    e(O.OP_DUP, O.OP_ADD);                    // pow *= 2
  }
  e(O.OP_FROMALTSTACK);                       // bacc (== Σ bit_k·2^k)
  pick(bAbs); e(O.OP_NUMEQUALVERIFY);         // assert bacc == b
  e(O.OP_DROP);                               // drop pow (=256)

  // ----- STEP 2: product pacc = Σ (a·2^k)·bit_k. accumulator pacc on alt, apow = a·2^k on main top. (bits already bound to b.) -----
  e(O.OP_0, O.OP_TOALTSTACK);                 // pacc = 0 (alt)
  pick(aAbs);                                 // apow = a·2^0 = a
  for (let k = 0; k < 8; k++) {
    pick(bitAbs(k));                          // bit_k (MINIMALIF re-pins minimality at OP_IF)
    e(O.OP_IF);                               // taken iff bit_k == 1
      e(O.OP_FROMALTSTACK);                   // pacc
      e(O.OP_OVER);                           // copy apow
      e(O.OP_ADD);                            // pacc + apow
      e(O.OP_TOALTSTACK);                     // pacc += apow
    e(O.OP_ENDIF);
    e(O.OP_DUP, O.OP_ADD);                    // apow *= 2
  }
  e(O.OP_DROP);                               // drop apow (= a·256)
  e(O.OP_FROMALTSTACK);                       // product on top

  // ----- leave EXACTLY [product]: stash it, drop the 10 inputs, restore. -----
  e(O.OP_TOALTSTACK);
  for (let i = 0; i < 10; i++) e(O.OP_DROP);  // drop a, b, bit_0..bit_7
  e(O.OP_FROMALTSTACK);                       // [product]
  if (depth !== 1) throw new Error(`chunkMulOps depth bookkeeping off: ${depth} (expected 1)`);
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length };
}

// the witness (deepest→top) for chunkMulOps: a, b, bit_0..bit_7.
export function chunkMulWitness(a, b) {
  if (!Number.isInteger(a) || a < 0 || a > 0xffff) throw new Error(`a must be a uint16 [0,65535]: ${a}`);
  return [enc(a), enc(b), ...bitsOf(b)];
}

// ============================================================================================================================
// mulN — schoolbook long multiplication composing chunkMul. RADIX 16×8 (decided by the chunkMul measurement): a = `na` uint16
// limbs, b = `nb` uint8 limbs, product = `nr = 2na+nb` base-256 limbs (a uint(16na)·uint(8nb)). SINGLE-SOURCED: the operands A_i
// and the bit-decompositions of each B_j live ONCE in a canonical witness region at the bottom; every partial PICKs from there
// (so a spender CANNOT use inconsistent A_i across partials). The bit-verify is HOISTED (each B_j verified once, reused across its
// column). Columns are emitted in DECREASING order (so acc_0 lands on top) ⟹ the LSB-first normalize is purely sequential (no
// random access). Normalize = witnessed division-by-256 per limb (`val == q·256 + r`, q·256 via 8 doublings) — the div sibling in
// miniature. The product limbs are left on the ALT stack (the test reconstructs a·b; a real pool single-sources them into c6).
// Design: docs/MUL_GADGET_DESIGN.md. Companion of the consensus-proven byte-limb adder (native/amounts.mjs).

// carry/quotient upper bound per normalize limb. Valid q=⌊val/256⌋ is tiny (≤~2^20 even at uint128 width); the 2^23 ceiling is
// the PRINCIPLED bound: it forces q·256 < 2^31 (a safe CScriptNum operand) via the explicit range-check — never relying on an
// overflow-throw — while leaving every honest q well inside. A malicious larger q is rejected here before the doubling.
const Q_BOUND = 1 << 23;

// pair (i,j) with 2i+j == p, within i∈[0,na), j∈[0,nb), in a fixed order (i ascending).
function partialsAt(p, na, nb) {
  const out = [];
  for (let i = 0; i < na; i++) { const j = p - 2 * i; if (j >= 0 && j < nb) out.push([i, j]); }
  return out;
}

// off-chain REFERENCE: A (na uint16 vals, LSB first), B (nb uint8 vals, LSB first) → {product (BigInt), resultLimbs, qs, rs}.
export function mulNRef(A, B) {
  const na = A.length, nb = B.length, nr = 2 * na + nb, nFat = 2 * na + nb - 2;
  let a = 0n, b = 0n;
  A.forEach((v, i) => { a += BigInt(v) << BigInt(16 * i); });
  B.forEach((v, j) => { b += BigInt(v) << BigInt(8 * j); });
  const accs = new Array(nFat).fill(0);
  for (let p = 0; p < nFat; p++) for (const [i, j] of partialsAt(p, na, nb)) accs[p] += A[i] * B[j];
  const qs = [], rs = []; let carry = 0;
  for (let p = 0; p < nr; p++) { const val = carry + (p < nFat ? accs[p] : 0); rs.push(val % 256); qs.push(Math.floor(val / 256)); carry = qs[p]; }
  if (carry !== 0) throw new Error(`mulNRef: product overflows ${nr} limbs (carry ${carry})`);
  let recon = 0n; rs.forEach((r, p) => { recon += BigInt(r) << BigInt(8 * p); });
  if (recon !== a * b) throw new Error(`mulNRef self-check failed: ${recon} != ${a * b}`);
  return { product: a * b, resultLimbs: rs, qs, rs, accs };
}

// the canonical witness (deepest→top): A_0..A_{na-1}, B_0..B_{nb-1}, the 8 bits of each B_j, then the nq block (q_0..q_{nr-1})
// then the nr block (r_0..r_{nr-1}) — nq and nr in SEPARATE contiguous blocks so the product limbs are stride-1 (comparator-ready).
export function mulNWitness(A, B) {
  const { qs, rs } = mulNRef(A, B);
  const w = [];
  for (const v of A) w.push(enc(v));
  for (const v of B) w.push(enc(v));
  for (const v of B) w.push(...bitsOf(v));
  for (let p = 0; p < rs.length; p++) w.push(enc(qs[p]));   // nq block
  for (let p = 0; p < rs.length; p++) w.push(enc(rs[p]));   // nr block (the product limbs)
  return w;
}

// opts.base = abs offset of THIS gadget's witness region within a larger stack (for composition); opts.totalDepth = the FULL stack
// depth (default = this region's Wtotal, i.e. standalone); opts.emit = push the product limbs to the alt stack (default true). With
// emit=false the gadget is VERIFY-ONLY and leaves the verified product limbs at their witness positions rAbs(p) (= base+Qbase+2p+1)
// — a comparator reads them directly, so two products compose with NO alt→main plumbing.
export function mulNOps(na, nb, { base = 0, totalDepth = null, emit = true } = {}) {
  const nr = 2 * na + nb, nFat = 2 * na + nb - 2;
  const aAbs = (i) => base + i;
  const bAbs = (j) => base + na + j;
  const bitAbs = (j, k) => base + na + nb + j * 8 + k;
  const Qbase = na + nb + nb * 8;
  const qAbs = (p) => base + Qbase + p;          // the nq (normalize-quotient) block
  const rAbs = (p) => base + Qbase + nr + p;     // the nr (result-limb) block — CONTIGUOUS so a comparator reads it stride-1
  const Wtotal = Qbase + 2 * nr;

  const ops = []; let depth = totalDepth ?? Wtotal;
  const DELTA = {
    [O.OP_ADD]: -1, [O.OP_DROP]: -1, [O.OP_DUP]: 1, [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_OVER]: 1, [O.OP_SWAP]: 0,
    [O.OP_VERIFY]: -1, [O.OP_NUMEQUALVERIFY]: -2, [O.OP_WITHIN]: -2, [O.OP_TOALTSTACK]: -1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_IF]: -1, [O.OP_ENDIF]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  // ----- step 0: HOISTED bit-verify — each B_j once: Σ bit_{j,k}·2^k == B_j (bits ∈{'',0x01}, MINIMALIF). verify-only, net 0. -----
  for (let j = 0; j < nb; j++) {
    e(O.OP_0, O.OP_TOALTSTACK);                  // bacc = 0
    e(O.OP_1);                                   // pow = 1
    for (let k = 0; k < 8; k++) {
      pick(bitAbs(j, k));
      e(O.OP_DUP, O.OP_0, enc(2), O.OP_WITHIN, O.OP_VERIFY);   // 0 <= bit < 2 (minimal)
      e(O.OP_IF); e(O.OP_FROMALTSTACK, O.OP_OVER, O.OP_ADD, O.OP_TOALTSTACK); e(O.OP_ENDIF);
      e(O.OP_DUP, O.OP_ADD);                     // pow *= 2
    }
    e(O.OP_FROMALTSTACK); pick(bAbs(j)); e(O.OP_NUMEQUALVERIFY);   // Σ == B_j
    e(O.OP_DROP);                                // drop pow
  }

  // ----- step 1: columns p = nFat-1 … 0 (decreasing ⟹ acc_0 ends on top). acc_p = Σ_{2i+j=p} A_i·B_j (each partial = chunkMul step-2). -----
  for (let p = nFat - 1; p >= 0; p--) {
    e(O.OP_0);                                   // acc_p = 0
    for (const [i, j] of partialsAt(p, na, nb)) {
      // product step (bits pre-verified): pacc on alt, apow = A_i; P = Σ (A_i·2^k)·bit_{j,k} ⟹ leaves P on top of acc_p.
      e(O.OP_0, O.OP_TOALTSTACK);                // pacc = 0
      pick(aAbs(i));                             // apow = A_i
      for (let k = 0; k < 8; k++) {
        pick(bitAbs(j, k));                      // MINIMALIF re-pins minimality
        e(O.OP_IF); e(O.OP_FROMALTSTACK, O.OP_OVER, O.OP_ADD, O.OP_TOALTSTACK); e(O.OP_ENDIF);
        e(O.OP_DUP, O.OP_ADD);                   // apow *= 2
      }
      e(O.OP_DROP);                              // drop apow
      e(O.OP_FROMALTSTACK);                      // P on top
      e(O.OP_ADD);                               // acc_p += P
    }
  }

  // ----- step 2: normalize the fat limbs → nr base-256 limbs (LSB-first, witnessed div-by-256). result limbs pushed to alt. -----
  e(O.OP_0);                                     // carry = 0 (on top of acc_0)
  for (let p = 0; p < nr; p++) {
    if (p < nFat) e(O.OP_ADD);                   // val = carry + acc_p   (p>=nFat: val = carry, already on top)
    // val on top. assert val == q_p·256 + r_p, 0<=r_p<256, 0<=q_p<2^24.
    pick(rAbs(p)); e(O.OP_DUP, O.OP_0, enc(256), O.OP_WITHIN, O.OP_VERIFY);   // r checked, on top
    pick(qAbs(p)); e(O.OP_DUP, O.OP_0, enc(Q_BOUND), O.OP_WITHIN, O.OP_VERIFY); // q checked, on top (r below, val below that)
    for (let d = 0; d < 8; d++) e(O.OP_DUP, O.OP_ADD);    // q *= 256
    e(O.OP_ADD);                                 // q·256 + r
    e(O.OP_NUMEQUALVERIFY);                      // == val (consumes val + recon) — r_p @ rAbs(p) is now the VERIFIED product limb
    if (emit) { pick(rAbs(p)); e(O.OP_TOALTSTACK); }  // (optional) materialize r_p → alt; with emit=false it stays at rAbs(p)
    pick(qAbs(p));                               // carry = q_p (on top, ready for next OP_ADD with acc_{p+1} below)
  }
  e(O.OP_0, O.OP_NUMEQUALVERIFY);                // final carry must be 0 (product fits in nr limbs)
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length, nr, nFat, Wtotal, rAbs };
}

// ============================================================================================================================
// cmpN — limb-wise comparator of two n-limb LE values X, Y (the AMM invariant `x'·y' ≥ x·y` operates on uint128 mulN outputs).
// PRECONDITION: each limb ∈ [0,255] (guaranteed when X,Y are mulN result limbs — the normalize pins 0≤r<256). Walks MSB→LSB and
// LATCHES the first nonzero per-limb difference (x_p − y_p): that most-significant differing byte alone decides the ordering, so
// its SIGN == sign(X−Y). Leaves the latched value on top: >0 ⟺ X>Y, <0 ⟺ X<Y, 0 ⟺ X==Y. Branch (state==0 ? d : state) is a real
// OP_IF/OP_ELSE, so depth is hand-tracked (the linear delta-helper can't see which branch runs).
export function cmpRef(X, Y) {
  for (let p = X.length - 1; p >= 0; p--) { if (X[p] !== Y[p]) return Math.sign(X[p] - Y[p]); }
  return 0;
}
export function cmpWitness(X, Y) { return [...X.map((v) => enc(v)), ...Y.map((v) => enc(v))]; }   // X limbs then Y limbs (LE)

// xBase/yBase = abs positions of the two limb blocks; startDepth = the FULL stack depth (default 2n = standalone witness [X|Y]).
// For embedding (e.g. comparing two mulN product regions in a bigger stack), pass the live stack depth + the two rAbs bases.
export function cmpOps(n, xBase = 0, yBase = n, startDepth = 2 * n) {
  const ops = [];
  let depth = startDepth;
  const pk = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  ops.push(O.OP_0); depth += 1;                       // state = 0 (no difference latched yet)
  for (let p = n - 1; p >= 0; p--) {
    pk(xBase + p);                                    // x_p
    pk(yBase + p);                                    // y_p
    ops.push(O.OP_SUB); depth -= 1;                   // d = x_p − y_p ∈ [−255,255]   → [.., state, d]
    ops.push(O.OP_OVER); depth += 1;                  // → [.., state, d, state]
    ops.push(O.OP_0, O.OP_NUMEQUAL);                  // → [.., state, d, (state==0)]   (push +1, NUMEQUAL −1 ⟹ net 0)
    ops.push(O.OP_IF); depth -= 1;                    // consume the bool        → [.., state, d]
    ops.push(O.OP_NIP);                               //   state==0 branch: drop old state, keep d   → [.., d]
    ops.push(O.OP_ELSE);
    ops.push(O.OP_DROP);                              //   else: drop d, keep state                  → [.., state]
    ops.push(O.OP_ENDIF);
    depth -= 1;                                       // both branches collapse [state,d] → 1 item
  }
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length };   // leaves the latched first-diff on top
}

// assert X ≥ Y (the AMM constant-product invariant). Appends to cmpOps: state ≥ 0.
export function cmpGEVerifyOps(n, xBase = 0, yBase = n, startDepth = 2 * n) {
  const { ops } = cmpOps(n, xBase, yBase, startDepth);
  ops.push(O.OP_0, O.OP_GREATERTHANOREQUAL, O.OP_VERIFY);   // latched-diff ≥ 0  ⟺  X ≥ Y
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length };
}

// ============================================================================================================================
// invariantGEOps — the AMM constant-product check `x'·y' ≥ x·y` composed END-TO-END (the value-conservation keystone, GATE 12):
// two `mulN` products (old = x·y, new = x'·y') VERIFIED in place (emit=false ⟹ their limbs sit at the witness rAbs positions), then
// `cmpGEVerify` over those two regions — NO alt plumbing, both products read directly from their witness. Operands are mulN limbs
// here (the c6/inline-value serialization TIE that single-sources x,y,x',y' from their byte fields layers on top, next step).
// Witness = [ OLD mulN region (x·y) | NEW mulN region (x'·y') ]. A k-decreasing swap (x'·y' < x·y) HALTs at the ≥.
export function invariantGEOps(na, nb) {
  const probe = mulNOps(na, nb);
  const W = probe.Wtotal, nr = probe.nr, totalDepth = 2 * W;
  const oldM = mulNOps(na, nb, { base: 0, totalDepth, emit: false });   // OLD product x·y  (region @ base 0)
  const newM = mulNOps(na, nb, { base: W, totalDepth, emit: false });   // NEW product x'·y' (region @ base W)
  // both verify-only ⟹ net 0 on main; the product limbs sit at their rAbs blocks. Assert NEW ≥ OLD (read in place, no plumbing):
  const cmp = cmpGEVerifyOps(nr, /*X=*/newM.rAbs(0), /*Y=*/oldM.rAbs(0), totalDepth);
  return { ops: [...oldM.ops, ...newM.ops, ...cmp.ops], W, totalDepth, nr };
}
// witness = [ OLD mulN witness (x as uint16 limbs A, y as uint8 limbs B) | NEW mulN witness (x', y') ].
export function invariantGEWitness({ Aold, Bold, Anew, Bnew }) {
  return [...mulNWitness(Aold, Bold), ...mulNWitness(Anew, Bnew)];
}

// lendingBorrowVerifyOps — the on-stack LENDING over-collateralization check: assert C·ltvNum ≥ B·scale (the loan B is within the
// LTV=ltvNum/scale of collateral C). REUSES invariantGEOps verbatim (the two-product ≥) — feed (Aold=B, Bold=scale, Anew=C,
// Bnew=ltvNum) ⟹ it asserts C·ltvNum ≥ B·scale. (The interest B·rate/scale reuses divN; the collateral PRICE comes from the AMM
// pool reserves as the oracle, C_value = C·y/x — a chained mul.)
export function lendingBorrowVerifyOps(na = 4, nb = 8) { return invariantGEOps(na, nb); }
export function lendingBorrowWitness({ B, scale, C, ltvNum }) {
  return invariantGEWitness({ Aold: _l16(B), Bold: _l8(scale), Anew: _l16(C), Bnew: _l8(ltvNum) });
}

// lpBurnVerifyOps — the on-stack LP-BURN pro-rata bound: assert `s·reserve ≥ withdraw·lpTotal` (the burner of s shares withdraws AT
// MOST its fraction s/lpTotal of `reserve` — flooring keeps the remaining LPs un-diluted). REUSES invariantGEOps (Aold=withdraw,
// Bold=lpTotal, Anew=s, Bnew=reserve ⟹ s·reserve ≥ withdraw·lpTotal). Run once per reserve (X token, Y BELLS).
export function lpBurnVerifyOps(na = 4, nb = 8) { return invariantGEOps(na, nb); }
export function lpBurnWitness({ withdraw, lpTotal, sBurn, reserve }) {
  return invariantGEWitness({ Aold: _l16(withdraw), Bold: _l8(lpTotal), Anew: _l16(sBurn), Bnew: _l8(reserve) });
}

// tiedInvariantGEOps — the brick-2 CAPSTONE (full GATE-12 closure at the gadget level): x'·y' ≥ x·y where all four operands are
// SINGLE-SOURCED from their 8-byte reserve serializations (the bytes c6 / the inline-ACP field commit). Composes: 2 verify-only
// mulN + reserveATie(x→A_old) + reserveBTie(y→B_old) + reserveATie(x'→A_new) + reserveBTie(y'→B_new) + cmpGEVerify. A mulN operand
// that doesn't match its serialization (a "free witness" reserve) is REJECTED by the tie. The swap leaf binds those serializations
// to c6/inline (step 4); here they are witness fields. (na=4, nb=8 ⟹ uint64 reserves.)
const _l16 = (v) => { const o = []; let t = BigInt(v); for (let i = 0; i < 4; i++) { o.push(Number(t & 0xffffn)); t >>= 16n; } return o; };
const _l8 = (v) => { const o = []; let t = BigInt(v); for (let j = 0; j < 8; j++) { o.push(Number(t & 0xffn)); t >>= 8n; } return o; };

// opts.base = abs offset of this gadget's witness region in a bigger stack (for embedding in the swap leaf); opts.startDepth =
// the FULL live stack depth (default = this region's localSize, i.e. standalone). Verify-only (net 0). [glue piece 1 of the
// complete-BUY-leaf assembly — DEFI_TOPOLOGY_DESIGN.md "REVIEW ROUND 2".]
export function tiedInvariantGEOps(na = 4, nb = 8, { base = 0, startDepth = null } = {}) {
  const probe = mulNOps(na, nb);
  const W = probe.Wtotal, nr = probe.nr;
  const serSize = 4 * nb + 2 * (2 * na);                  // 4 reserves × nb ser bytes + 2 A-reserves × 2na aux byte-nums
  const localSize = 2 * W + serSize;
  const totalDepth = startDepth ?? localSize;             // full stack depth (standalone = localSize)
  const S = base + 2 * W;                                 // serialization region start (shifted by base)
  const xSer = S, xAux = S + nb, ySer = S + nb + 2 * na, xpSer = ySer + nb, xpAux = xpSer + nb, ypSer = xpAux + 2 * na;
  const oldM = mulNOps(na, nb, { base: base + 0, totalDepth, emit: false });
  const newM = mulNOps(na, nb, { base: base + W, totalDepth, emit: false });
  const tieXA = reserveATieVerifyOps({ serBase: xSer, limbBase: base + 0, numBase: xAux, startDepth: totalDepth, na });
  const tieYB = reserveBTieVerifyOps({ serBase: ySer, numBase: base + na, startDepth: totalDepth, n: nb });        // B_old @ base+na..
  const tieXpA = reserveATieVerifyOps({ serBase: xpSer, limbBase: base + W, numBase: xpAux, startDepth: totalDepth, na });
  const tieYpB = reserveBTieVerifyOps({ serBase: ypSer, numBase: base + W + na, startDepth: totalDepth, n: nb });  // B_new @ base+W+na..
  const cmp = cmpGEVerifyOps(nr, newM.rAbs(0), oldM.rAbs(0), totalDepth);
  return { ops: [...oldM.ops, ...newM.ops, ...tieXA.ops, ...tieYB.ops, ...tieXpA.ops, ...tieYpB.ops, ...cmp.ops], W, totalDepth, nr, S, xSer, localSize };
}
export function tiedInvariantGEWitness({ x, y, xp, yp }) {
  return [
    ...mulNWitness(_l16(x), _l8(y)),                      // OLD mulN region (base 0)
    ...mulNWitness(_l16(xp), _l8(yp)),                    // NEW mulN region (base W)
    ..._l8(x).map((b) => B(b)), ..._l8(x).map((b) => enc(b)),    // x_ser, x_aux
    ..._l8(y).map((b) => B(b)),                                  // y_ser
    ..._l8(xp).map((b) => B(b)), ..._l8(xp).map((b) => enc(b)),  // xp_ser, xp_aux
    ..._l8(yp).map((b) => B(b)),                                 // yp_ser
  ];
}

// ============================================================================================================================
// swapConservationOps — the TOKEN-side conservation of a pool update (the other half of the pool-update correctness; the value
// half is the invariant). Verifies `x == x' + tokenOut` for uint64 token amounts (the pool's token reserve DECREASE x−x' == the
// token the trader RECEIVES), single-sourced from the byte serializations c6 commits ⟹ the pool can't mint/leak token. A base-256
// 8-limb LE add with carry: per limb s = x'_p + tokenOut_p + carry, assert (s − 256·carryOut) == x_p, final carry == 0 (no
// overflow). Each wire byte welded to its CScriptNum operand via the proven limbConsistency (the b_ser↔b_num tie). Witness
// (deepest→top): x_ser(8), x_num(8), xp_ser(8), xp_num(8), to_ser(8), to_num(8).
export function swapConservationOps({ base = 0, startDepth = null } = {}) {
  const xSer = base + 0, xNum = base + 8, xpSer = base + 16, xpNum = base + 24, toSer = base + 32, toNum = base + 40;
  const totalDepth = startDepth ?? 48;                   // localSize = 48; pass startDepth to embed in a bigger stack
  const ops = []; let depth = totalDepth;
  const DELTA = { [O.OP_ADD]: -1, [O.OP_SUB]: -1, [O.OP_DUP]: 1, [O.OP_0]: 1, [O.OP_GREATERTHANOREQUAL]: -1, [O.OP_TUCK]: 1, [O.OP_NUMEQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const tieB = (serBase, numBase) => { for (let j = 0; j < 8; j++) { pick(numBase + j); pick(serBase + j); ops.push(...limbConsistencyVerifyOps()); depth -= 2; } };
  tieB(xSer, xNum); tieB(xpSer, xpNum); tieB(toSer, toNum);   // weld each value's ser↔num

  e(O.OP_0);                                             // carry = 0
  for (let p = 0; p < 8; p++) {
    pick(xpNum + p); pick(toNum + p); e(O.OP_ADD); e(O.OP_ADD);     // s = carry + x'_p + tokenOut_p  (≤ 511 < 2^31)
    e(O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL);      // [s, carryOut]
    e(O.OP_TUCK);                                        // [carryOut, s, carryOut]
    for (let d = 0; d < 8; d++) e(O.OP_DUP, O.OP_ADD);   // 256·carryOut
    e(O.OP_SUB);                                         // [carryOut, r]   (r = s − 256·carryOut)
    pick(xNum + p); e(O.OP_NUMEQUALVERIFY);              // r == x_p  ⟹ [carryOut] threads as the next carry
  }
  e(O.OP_0, O.OP_NUMEQUALVERIFY);                        // final carry == 0 (x fits 8 bytes; no overflow/underflow)
  // abs positions of each value's ser/num blocks — a composing leaf WELDs x'/tokenOut/x here to the invariant + the c6 outputs.
  return { ops, abs: { xSer, xNum, xpSer, xpNum, toSer, toNum }, localSize: 48 };
}
export function swapConservationWitness(x, xp, tokenOut) {
  const ser = (v) => _l8(v).map((b) => B(b));
  const num = (v) => _l8(v).map((b) => enc(b));
  return [...ser(x), ...num(x), ...ser(xp), ...num(xp), ...ser(tokenOut), ...num(tokenOut)];
}

// poolUpdateVerifyOps — the pool-update VERIFICATION composed: the value-half (`tiedInvariantGEOps`: x'·y' ≥ x·y) AND the
// token-half (`swapConservationOps`: x == x' + tokenOut), CROSS-WELDED so `x` and `x'` are the IDENTICAL bytes in both halves
// (single-source — a swap can't satisfy the invariant with one (x,x') and conservation with another). This is the complete
// pool-update correctness; the swap leaf then binds y/y'/x'/tokenOut to the c6 outputs + the inline ACP value + the parent
// backtrace (the output-construction + ACP-bind from buyLeaf.mjs, and `buyParentReconstructOps` for old-x — the final wiring).
export function poolUpdateVerifyOps(na = 4, nb = 8, { startDepth = null } = {}) {
  const probe = tiedInvariantGEOps(na, nb);
  const Linv = probe.localSize, W = probe.W;
  const consBase = Linv, localSize = Linv + 48;
  const totalDepth = startDepth ?? localSize;            // full stack depth (standalone = localSize; a leaf passes the bigger depth)
  const inv = tiedInvariantGEOps(na, nb, { base: 0, startDepth: totalDepth });
  const cons = swapConservationOps({ base: consBase, startDepth: totalDepth });
  const ops = [...inv.ops, ...cons.ops];
  let depth = totalDepth;
  const pk = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const weld = (a, b) => { pk(a); pk(b); ops.push(O.OP_EQUALVERIFY); depth -= 2; };   // EQUALVERIFY two bytes (net 0)
  const invXSer = 2 * W, invXpSer = 2 * W + 24;           // inv: S=base+2W ⟹ xSer=2W, xpSer=2W+24
  const consXSer = consBase + 0, consXpSer = consBase + 16;
  for (let i = 0; i < 8; i++) { weld(invXSer + i, consXSer + i); weld(invXpSer + i, consXpSer + i); }  // x and x' identical across halves
  // ypSer/ySer abs (within this region @ base 0) — a leaf welds y'→output[0].value, y→inline ACP value: S=2W ⟹ ypSer=2W+40, ySer=2W+16.
  return { ops, totalDepth, Linv, W, localSize };
}
export function poolUpdateVerifyWitness({ x, y, xp, yp, tokenOut }) {
  return [...tiedInvariantGEWitness({ x, y, xp, yp }), ...swapConservationWitness(x, xp, tokenOut)];
}

// sellPoolUpdateVerifyOps — the SELL-direction pool-update VERIFICATION: the trader DEPOSITS a token note (amount d) into the pool
// (the pool's token reserve GROWS x'=x+d) and receives BELLS (y'<y). Invariant x'·y' ≥ x·y + conservation x' == x + d. Reuses the
// same two gadgets as the BUY but the conservation is `operand1==operand2+operand3` with operand1=x'(new, the SUM) ⟹ the x/x'
// single-source welds are CROSSED (inv.x ↔ cons.operand2, inv.x' ↔ cons.operand1). The SELL leaf binds this via the COMMITTED
// 2-input topology (vin0=pool, vin1=trader token note; DEFAULT sighash c2=SHA256(op0‖op1)) + a DUAL backtrace (x from vin0's
// parent, d from vin1's parent) — NOT ACP (ACP can't prove cross-input x'=x+d).
export function sellPoolUpdateVerifyOps(na = 4, nb = 8, { startDepth = null } = {}) {
  const probe = tiedInvariantGEOps(na, nb);
  const Linv = probe.localSize, W = probe.W;
  const consBase = Linv, localSize = Linv + 48;
  const totalDepth = startDepth ?? localSize;
  const inv = tiedInvariantGEOps(na, nb, { base: 0, startDepth: totalDepth });
  const cons = swapConservationOps({ base: consBase, startDepth: totalDepth });   // verifies operand1 == operand2 + operand3
  const ops = [...inv.ops, ...cons.ops];
  let depth = totalDepth;
  const pk = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const weld = (a, b) => { pk(a); pk(b); ops.push(O.OP_EQUALVERIFY); depth -= 2; };
  const invXSer = 2 * W, invXpSer = 2 * W + 24, consXSer = consBase, consXpSer = consBase + 16;   // cons.xSer=x'(op1), cons.xpSer=x(op2)
  for (let i = 0; i < 8; i++) { weld(invXSer + i, consXpSer + i); weld(invXpSer + i, consXSer + i); }  // CROSSED: x_old↔op2, x'_new↔op1
  return { ops, totalDepth, Linv, W, localSize };
}
export function sellPoolUpdateVerifyWitness({ x, y, xp, yp, d }) {
  return [...tiedInvariantGEWitness({ x, y, xp, yp }), ...swapConservationWitness(xp, x, d)];   // cons verifies x'(xp) == x + d
}

// ============================================================================================================================
// divN — Euclidean division D = q·d + r, 0 ≤ r < d, d ≠ 0 (lending `principal·rate/scale`). Built as `mulN(q, d)` with the
// accumulator SEEDED by r's limbs (so the columns compute q·d + r in ONE pass — no separate adder) and the normalize ASSERTS each
// result limb == D's limb (instead of emitting). The quotient q (na uint16 limbs) and remainder r (nd uint8 limbs) are WITNESSED
// and VERIFIED — same BIND-not-DECLARE family as the rest. d's bits are decomposed/verified as in mulN. Widths: D = nD uint8
// limbs, d = nd uint8 limbs (divisor up to uint(8·nd)), q = na uint16 limbs. The witnessed-div normalize the project already
// proved IS the per-limb /256; this generalizes the *outer* division to an arbitrary divisor.
export function divNRef(Dval, dval) {
  const D = BigInt(Dval), dd = BigInt(dval);
  if (dd === 0n) throw new Error('divisor 0');
  const q = D / dd, r = D % dd;
  return { q, r, check: q * dd + r === D };
}
// witness (deepest→top): q (na uint16), d (nd uint8), D (nD uint8), r (nd uint8), bits of each d_j (nd·8), (nq_p,nr_p) per result limb.
export function divNWitness(Dval, dval, na, nd, nD) {
  const { q, r } = divNRef(Dval, dval);
  const A = limbs16BI(q, na), B = limbs8BI(BigInt(dval), nd), Dl = limbs8BI(BigInt(Dval), nD), R = limbs8BI(r, nd);
  // simulate the seeded accumulation to derive the normalize witnesses (nq_p, nr_p).
  const nResult = 2 * na + nd, nFat = 2 * na + nd - 2;
  const accs = new Array(nFat).fill(0);
  for (let p = 0; p < nFat; p++) { for (const [i, j] of partialsAt(p, na, nd)) accs[p] += A[i] * B[j]; if (p < nd) accs[p] += R[p]; }
  const nq = [], nr = []; let carry = 0;
  for (let p = 0; p < nResult; p++) { const val = carry + (p < nFat ? accs[p] : 0); nr.push(val % 256); nq.push(Math.floor(val / 256)); carry = nq[p]; }
  if (carry !== 0) throw new Error('divN: q·d+r overflows nResult limbs');
  for (let p = 0; p < nResult; p++) { const tgt = p < nD ? Dl[p] : 0; if (nr[p] !== tgt) throw new Error(`divN self-check: result limb ${p} ${nr[p]} != D ${tgt}`); }
  const w = [];
  for (const v of A) w.push(enc(v));
  for (const v of B) w.push(enc(v));
  for (const v of Dl) w.push(enc(v));
  for (const v of R) w.push(enc(v));
  for (const v of B) w.push(...bitsOf(v));
  for (let p = 0; p < nResult; p++) { w.push(enc(nq[p]), enc(nr[p])); }
  return w;
}
function limbs16BI(x, n) { const o = []; let v = BigInt(x); for (let i = 0; i < n; i++) { o.push(Number(v & 0xffffn)); v >>= 16n; } if (v !== 0n) throw new Error('value exceeds na uint16 limbs'); return o; }
function limbs8BI(x, n) { const o = []; let v = BigInt(x); for (let i = 0; i < n; i++) { o.push(Number(v & 0xffn)); v >>= 8n; } if (v !== 0n) throw new Error('value exceeds n uint8 limbs'); return o; }

// ============================================================================================================================
// reserveU16TieOps — the single-source BRIDGE for the bound AMM (AMM_INVARIANT_DESIGN.md): tie a uint16 `mulN` a-limb A_num to
// the TWO c6-serialization wire bytes (lo_ser, hi_ser) it stands for. Reuses the PROVEN `limbConsistencyVerifyOps` to weld each
// byte to its minimal CScriptNum (lo_num/hi_num — a byte ≥0x80 is NOT its own minimal num, so the tie is mandatory), then asserts
// A_num == lo_num + 256·hi_num (256· = 8 doublings). VERIFY-ONLY (net 0; reads copies via OP_PICK so the inputs survive for the
// covenant's c6 serialization). A spender therefore CANNOT feed `mulN` an a-limb that differs from the c6-bound reserve bytes.
// Witness (deepest→top): A_num, lo_ser, hi_ser, lo_num, hi_num.
export function reserveU16TieOps() {
  const A_ABS = 0, LOSER = 1, HISER = 2, LONUM = 3, HINUM = 4;
  const ops = []; let depth = 5;
  const DELTA = { [O.OP_ADD]: -1, [O.OP_DUP]: 1, [O.OP_NUMEQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const tie = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };   // black-box: consumes [num, ser], verify-only

  pick(LONUM); pick(HINUM);                              // copies for the combine
  for (let d = 0; d < 8; d++) e(O.OP_DUP, O.OP_ADD);     // hi_num *= 256
  e(O.OP_ADD);                                           // lo_num + 256·hi_num
  pick(A_ABS); e(O.OP_NUMEQUALVERIFY);                   // == A_num  (also forces A ∈[0,65535] since lo,hi∈[0,255])
  pick(LONUM); pick(LOSER); tie();                       // weld lo_ser ↔ lo_num
  pick(HINUM); pick(HISER); tie();                       // weld hi_ser ↔ hi_num
  if (depth !== 5) throw new Error(`reserveU16TieOps depth off: ${depth}`);
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length };
}
export function reserveU16TieWitness(A) {
  if (!Number.isInteger(A) || A < 0 || A > 0xffff) throw new Error(`A must be uint16 [0,65535]: ${A}`);
  const lo = A & 0xff, hi = (A >> 8) & 0xff;
  return [enc(A), B(lo), B(hi), enc(lo), enc(hi)];        // A_num, lo_ser, hi_ser, lo_num, hi_num
}

// ----- FULL-RESERVE single-source bridges (brick-2 finition): tie a uint64 reserve's 8 wire bytes (the c6/inline-ACP field) to
// its mulN operand limbs. EMBEDDABLE + VERIFY-ONLY (read copies via PICK, net 0) so the swap leaf drops them in beside mulN. -----

// reserveBTieVerifyOps — ties the b-input (8 uint8 limbs @ numBase+j) to the 8 wire bytes (@ serBase+j) via the PROVEN
// limbConsistencyVerifyOps. The mulN B_j ARE these nums; this welds them one-value to the serialized bytes that c6 commits.
export function reserveBTieVerifyOps({ serBase, numBase, startDepth, n = 8 }) {
  const ops = []; let depth = startDepth;
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  for (let j = 0; j < n; j++) {
    pick(numBase + j); pick(serBase + j);                // [.., b_num, b_ser]
    ops.push(...limbConsistencyVerifyOps()); depth -= 2; // consumes both, verify-only
  }
  return { ops };
}

// reserveATieVerifyOps — ties the a-input (na uint16 limbs @ limbBase+i) to its 2na wire bytes (@ serBase) via 2na byte-nums
// (@ numBase): per limb, A_i == lo_num + 256·hi_num AND each byte-num welded to its wire byte (limbConsistency). The embeddable
// loop form of reserveU16TieOps.
export function reserveATieVerifyOps({ serBase, limbBase, numBase, startDepth, na = 4 }) {
  const ops = []; let depth = startDepth;
  const DELTA = { [O.OP_ADD]: -1, [O.OP_DUP]: 1, [O.OP_NUMEQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const tie = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };
  for (let i = 0; i < na; i++) {
    const lo = 2 * i, hi = 2 * i + 1;
    pick(numBase + lo); pick(numBase + hi);              // lo_num, hi_num (copies)
    for (let d = 0; d < 8; d++) e(O.OP_DUP, O.OP_ADD);   // hi_num *= 256
    e(O.OP_ADD); pick(limbBase + i); e(O.OP_NUMEQUALVERIFY);  // A_i == lo_num + 256·hi_num
    pick(numBase + lo); pick(serBase + lo); tie();       // weld lo_ser ↔ lo_num
    pick(numBase + hi); pick(serBase + hi); tie();       // weld hi_ser ↔ hi_num
  }
  return { ops };
}

export function divNOps(na, nd, nD) {
  const nResult = 2 * na + nd, nFat = 2 * na + nd - 2;
  const aAbs = (i) => i;
  const bAbs = (j) => na + j;
  const DAbs = (p) => na + nd + p;
  const rAbs = (j) => na + nd + nD + j;
  const bitBase = na + nd + nD + nd;
  const bitAbs = (j, k) => bitBase + j * 8 + k;
  const NQ = bitBase + nd * 8;
  const nqAbs = (p) => NQ + 2 * p;
  const nrAbs = (p) => NQ + 2 * p + 1;
  const Wtotal = NQ + 2 * nResult;

  const ops = []; let depth = Wtotal;
  const DELTA = {
    [O.OP_ADD]: -1, [O.OP_SUB]: -1, [O.OP_DROP]: -1, [O.OP_DUP]: 1, [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_OVER]: 1, [O.OP_NIP]: -1,
    [O.OP_VERIFY]: -1, [O.OP_NUMEQUALVERIFY]: -2, [O.OP_WITHIN]: -2, [O.OP_NUMEQUAL]: -1, [O.OP_GREATERTHAN]: -1, [O.OP_LESSTHAN]: -1,
    [O.OP_TOALTSTACK]: -1, [O.OP_FROMALTSTACK]: 1, [O.OP_IF]: -1, [O.OP_ENDIF]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  // step A: q's limbs are proper uint16 (hygiene) + d ≠ 0 (Σ d_j > 0).
  for (let i = 0; i < na; i++) { pick(aAbs(i)); e(O.OP_0, enc(1 << 16), O.OP_WITHIN, O.OP_VERIFY); }
  e(O.OP_0);
  for (let j = 0; j < nd; j++) { pick(bAbs(j)); e(O.OP_ADD); }
  e(O.OP_0, O.OP_GREATERTHAN, O.OP_VERIFY);            // d ≠ 0

  // step B: r < d (MSB-first latch over nd limbs; r_p range-checked ∈[0,255]). assert latched diff < 0.
  e(O.OP_0);                                          // state = 0
  for (let p = nd - 1; p >= 0; p--) {
    pick(rAbs(p)); e(O.OP_DUP, O.OP_0, enc(256), O.OP_WITHIN, O.OP_VERIFY);   // 0 ≤ r_p < 256
    pick(bAbs(p)); e(O.OP_SUB);                        // diff = r_p − d_p   → [.., state, diff]
    e(O.OP_OVER, O.OP_0, O.OP_NUMEQUAL);               // [.., state, diff, state==0]
    ops.push(O.OP_IF); depth -= 1;                     // (manual: IF/ELSE branch)
    ops.push(O.OP_NIP);
    ops.push(O.OP_ELSE);
    ops.push(O.OP_DROP);
    ops.push(O.OP_ENDIF);
    depth -= 1;                                        // [state,diff] → 1
  }
  e(O.OP_0, O.OP_LESSTHAN, O.OP_VERIFY);               // latched diff < 0  ⟺  r < d

  // step C: hoisted bit-verify of each d_j (also forces d_j ∈[0,255]).
  for (let j = 0; j < nd; j++) {
    e(O.OP_0, O.OP_TOALTSTACK); e(O.OP_1);
    for (let k = 0; k < 8; k++) {
      pick(bitAbs(j, k)); e(O.OP_DUP, O.OP_0, enc(2), O.OP_WITHIN, O.OP_VERIFY);
      e(O.OP_IF); e(O.OP_FROMALTSTACK, O.OP_OVER, O.OP_ADD, O.OP_TOALTSTACK); e(O.OP_ENDIF);
      e(O.OP_DUP, O.OP_ADD);
    }
    e(O.OP_FROMALTSTACK); pick(bAbs(j)); e(O.OP_NUMEQUALVERIFY); e(O.OP_DROP);
  }

  // step D: columns p = nFat-1 … 0, SEEDED by r (acc_p starts at r_p for p<nd) ⟹ computes q·d + r.
  for (let p = nFat - 1; p >= 0; p--) {
    if (p < nd) pick(rAbs(p)); else e(O.OP_0);        // acc_p = r_p (seed) or 0
    for (const [i, j] of partialsAt(p, na, nd)) {
      e(O.OP_0, O.OP_TOALTSTACK); pick(aAbs(i));      // pacc=0, apow=q_i
      for (let k = 0; k < 8; k++) {
        pick(bitAbs(j, k));
        e(O.OP_IF); e(O.OP_FROMALTSTACK, O.OP_OVER, O.OP_ADD, O.OP_TOALTSTACK); e(O.OP_ENDIF);
        e(O.OP_DUP, O.OP_ADD);
      }
      e(O.OP_DROP); e(O.OP_FROMALTSTACK); e(O.OP_ADD); // acc_p += q_i·d_j
    }
  }

  // step E: normalize, ASSERTING each result limb == D_p (or 0 for p ≥ nD).
  e(O.OP_0);                                          // carry = 0
  for (let p = 0; p < nResult; p++) {
    if (p < nFat) e(O.OP_ADD);                        // val = carry + acc_p
    pick(nrAbs(p)); e(O.OP_DUP, O.OP_0, enc(256), O.OP_WITHIN, O.OP_VERIFY);
    pick(nqAbs(p)); e(O.OP_DUP, O.OP_0, enc(Q_BOUND), O.OP_WITHIN, O.OP_VERIFY);
    for (let d = 0; d < 8; d++) e(O.OP_DUP, O.OP_ADD);
    e(O.OP_ADD); e(O.OP_NUMEQUALVERIFY);             // val == nq·256 + nr
    pick(nrAbs(p));                                   // the result byte
    if (p < nD) { pick(DAbs(p)); e(O.OP_NUMEQUALVERIFY); } else e(O.OP_0, O.OP_NUMEQUALVERIFY);  // == D_p / 0
    pick(nqAbs(p));                                   // carry = nq_p
  }
  e(O.OP_0, O.OP_NUMEQUALVERIFY);                      // final carry 0
  return { ops, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length, nResult, nFat, Wtotal };
}
