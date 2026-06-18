// _audit_merge_peak.mjs — PEAK-STACK feasibility gate for a $BOUND MERGE leaf (dual-backtrace).
//
// A merge of 2 token notes is 2 separate leaf executions; sound conservation forces EACH execution to
// BACKTRACE BOTH inputs (two parent-reconstruction "kernel" runs on one stack) then assert
// amount_out == amount_in_0 + amount_in_1. The worry: two reconstructions + parked registers + the
// conservation adder, all while the full witness sits at the bottom, could push the peak concurrent
// stack >= MAX_STACK_SIZE=1000 = a hard consensus reject of every honest merge.
//
// This audit composes ONE faithful dual-backtrace op stream (worst shape: both inputs degree Mp=4,
// spent child j=3, N=8 limbs, KEY arm), runs it through scriptsim.runScript (which now returns
// peakStack = the main+alt item-count high-water mark), and reports the real number against 1000.
//
// IMPORTANT (faithfulness): the committed kernel splitParentReconstructV2Ops hardcodes its own witness
// slice at the BOTTOM (committedAbs=0, vin0Abs=1, ...). Two kernels cannot BOTH read a distinct
// bottom-anchored slice with the unmodified helper, so KERNEL_OTHER is a RELOCATABLE copy of that
// helper, op-for-op identical except every absolute index is shifted by a `base` offset. The op COST
// (hence the stack cost) is byte-identical to the real kernel — only the pick literals differ. No
// committed source file is modified.
//
// Run: node native/_audit_merge_peak.mjs
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType, STATE_V2_PREFIX } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { splitFullLineageSplitGrandparentV2Ops, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';
import { splitParentReconstructV2Ops, splitParentV2Witness } from './p1e3SplitLineageV2.mjs';
import { adderOps, limbNum, limbSer, amountLimbsN } from './amounts.mjs';
import { FRAME } from './p1e3Const.mjs';
import { HDR_S, splitMid, LOCKTIME0 } from './p1e3SplitConst.mjs';

const O = bells.opcodes;
const S = bells.crypto.sha256, H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const N = 8;

// scriptsim does not expose an element-size high-water mark, so we instrument runScript ourselves: wrap
// the same ops/stack but tap every stack mutation. Simpler + exact: re-run and, since runScript builds
// real bytes, the largest element a backtrace ever builds is the fully-reconstructed parent tx preimage
// (each OP_CAT step is <= that). We measure it directly from the built parent txs (the genuine worst
// element), and assert scriptsim's <=520B guard never fired (it throws otherwise). The conservation
// limbs/amounts are all <= 8B, far below.
function maxElemFromParents(parentLens) { return Math.max(0, ...parentLens); }

// ===========================================================================================
// (1) BASELINE — the WORST existing SPLIT leaf (the E test, verbatim): Mp=4, j=3, M=4, gp=split-4.
// One kernel reconstruction + a depth-2 split-grandparent prefix. This both validates our imports/
// witness wiring AND gives the single-backtrace baseline peak_split.
// ===========================================================================================
function baselineSplit() {
  const Mp = 4, j = 3, M = 4, Mp_gp = 4, jprime = 3;
  const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
  const consts = { tokenId: G, changeSPK };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);
  const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: k % 3 }));
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime, kids, changeValGp: 7000 });
  const txpKids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? 14_000_000n : BigInt(2_000_000 * (k + 1)), owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY }));
  const txp = (() => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(hash256(gp.txGP), 2 * jprime, 0xffffffff);
    for (const c of txpKids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
    tx.addOutput(changeSPK, 9000);
    const legacy = tx.toBuffer();
    return { committedTxidP: hash256(legacy), jValueSats: txpKids[j].value, vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000 };
  })();
  const curOuts = [
    { owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 2_000_000n, ownerType: OwnerType.KEY },
    { owner: Buffer.alloc(20, 0xa1), value: 40000, amount: 3_000_000n, ownerType: OwnerType.SCRIPT },
    { owner: Buffer.alloc(20, 0xa2), value: 40000, amount: 4_000_000n, ownerType: OwnerType.KEY },
    { owner: Buffer.alloc(20, 0xa3), value: 40000, amount: 5_000_000n, ownerType: OwnerType.BURN }]; // Σ=14M
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(G, o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: 15000, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({
    parent: { committedTxidP: txp.committedTxidP, vin0Outpoint: txp.vin0Outpoint, changeVal: txp.changeVal, outputs: txpKids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: curOuts.map((c) => ({ owner: c.owner, value: c.value, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N });
  const ops = splitFullLineageSplitGrandparentV2Ops(Mp, j, M, N, Mp_gp, consts);
  const initialStack = [...w, ...gp.pieces];
  const r = runScript(ops, initialStack, sighash);
  return { r, witnessLen: initialStack.length };
}

// ===========================================================================================
// (2) DUAL-BACKTRACE CORE — TWO parent reconstructions on ONE stack + a conservation adder.
//
// KERNEL_SELF  = splitParentReconstructV2Ops(4,3,...) reading witness slice @ abs 0..18 (W=19).
// KERNEL_OTHER = a RELOCATABLE op-identical copy reading slice @ abs 19..37 (base=19).
// Both parents are real txs; both kernels' hash256(txP)==committedTxidP EQUALVERIFY must pass.
//
// After both kernels: main = [.., (ot_self,owner_self,amt_self), (ot_other,owner_other,amt_other)]
// (amt_other on top). CONSERVATION runs adderOps(8): committedSer ‖ [a_i,b_i,s_num_i,s_ser_i] welded
// to amount_out == amount_in_self + amount_in_other, where the adder operands come from witness limbs
// that we SEPARATELY assert equal the two PARKED amounts (the prompt-sanctioned variant — exercises
// the adder's stack cost with the full witness still resident at the bottom).
// ===========================================================================================

// A relocatable copy of splitParentReconstructV2Ops. OP-FOR-OP IDENTICAL to the committed helper
// (same e()/pick()/DELTA, same order) except every absolute index is `base`-shifted. `extraAbove` =
// items above THIS kernel's own slice (== base for SELF if no extra-above-self... handled by caller).
// `base` = abs index of this kernel's deepest witness item; `startDepth` = the TRUE total stack height
// at the instant this kernel begins (must count items both BELOW and ABOVE this kernel's slice). The
// committed helper passes W+extraAbove because it assumes base=0 (nothing below); a relocated kernel
// has `base` items below, so startDepth is given explicitly.
function relocatableKernelOps(M, j, { tokenId, ownSPK, changeSPK, base = 0, startDepth, ownSpkAbs = null, changeSpkAbs = null }) {
  const vsOwn = Buffer.concat([B(0x22), ownSPK]);
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const SPLIT_MID = splitMid(M);
  const committedAbs = base + 0, vin0Abs = base + 1, changeValAbs = base + 2;
  const FW = 4;
  const valueAbs = (k) => base + 3 + FW * k, amountAbs = (k) => base + 3 + FW * k + 1, ownerAbs = (k) => base + 3 + FW * k + 2, ownerTypeAbs = (k) => base + 3 + FW * k + 3;
  const W = 3 + FW * M;
  const ops = []; let depth = startDepth;
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  e(HDR_S);
  pick(vin0Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);
  e(SPLIT_MID, O.OP_CAT);
  for (let k = 0; k < M; k++) {
    pick(valueAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
    if (ownSpkAbs === null) e(vsOwn, O.OP_CAT, O.OP_CAT);
    else { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); }
    e(STATE_V2_PREFIX); pick(ownerTypeAbs(k)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT);
    e(tokenId, O.OP_CAT);
    pick(amountAbs(k)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);
    pick(ownerAbs(k)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256);
    e(FRAME, O.OP_SWAP, O.OP_CAT, O.OP_CAT);
    if (k === j) { pick(amountAbs(k)); e(O.OP_TOALTSTACK); pick(ownerAbs(k)); e(O.OP_TOALTSTACK); pick(ownerTypeAbs(k)); e(O.OP_TOALTSTACK); }
  }
  pick(changeValAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  if (changeSpkAbs === null) e(vsChange, O.OP_CAT, O.OP_CAT);
  else { pick(changeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT, O.OP_CAT); }
  e(LOCKTIME0, O.OP_CAT);
  e(O.OP_SHA256, O.OP_SHA256);
  pick(committedAbs); e(O.OP_EQUALVERIFY);
  e(O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_FROMALTSTACK); // [.., owner_type_in, owner_in, amount_in]
  return { ops, W };
}

// build a real degree-Mp split parent tx and the v2 kernel witness slice for child j.
function buildParent(Mp, j, amountIn, G, ownSPK, changeSPK, owner_in, seed) {
  const kids = Array.from({ length: Mp }, (_, k) => ({
    value: 50000 + 1000 * k,
    amount: k === j ? BigInt(amountIn) : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k),
    ownerType: OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([seed])), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  const committedTxidP = hash256(legacy);
  const slice = splitParentV2Witness({
    committedTxidP, vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000,
    outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) });
  // the kernel reconstructs this exact legacy serialization on-stack (the largest element it ever builds).
  return { committedTxidP, slice, preimageLen: legacy.length };
}

function dualBacktrace() {
  const Mp = 4, j = 3;
  const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
  const owner_in = Buffer.alloc(20, 0x66);
  const AMT_SELF = 14_000_000n, AMT_OTHER = 7_000_000n, AMT_OUT = AMT_SELF + AMT_OTHER; // 21M

  const self = buildParent(Mp, j, AMT_SELF, G, ownSPK, changeSPK, owner_in, 0x42);
  const other = buildParent(Mp, j, AMT_OTHER, G, ownSPK, changeSPK, owner_in, 0x43);

  const Wk = 3 + 4 * Mp; // 19 per kernel slice

  // --- conservation adder witness (deepest→top, per amounts.adderWitness): committedSer ‖ [a,b,s_num,s_ser]_{N-1..0]
  const aL = amountLimbsN(AMT_SELF, N), bL = amountLimbsN(AMT_OTHER, N), sL = amountLimbsN(AMT_OUT, N);
  const adderW = [Buffer.from(sL)]; // committedSer = amount_out LE (== amount_out_ser, what the c6/stateOut would commit)
  for (let i = N - 1; i >= 0; i--) adderW.push(limbNum(aL[i]), limbNum(bL[i]), limbNum(sL[i]), limbSer(sL[i]));
  // weld-check operands: 8 b_ser limbs of each parked amount (to assert OP_CAT(b_ser) == parked amount_in).
  const selfSerW = []; for (let i = 0; i < N; i++) selfSerW.push(limbSer(aL[i]));   // amount_in_self limbs, LSB-first
  const otherSerW = []; for (let i = 0; i < N; i++) otherSerW.push(limbSer(bL[i])); // amount_in_other limbs, LSB-first

  // ---- witness layout (deepest -> top) ----
  //   [ KERNEL_SELF slice (19) ] [ KERNEL_OTHER slice (19) ] [ adderW ] [ selfSerW(8) ] [ otherSerW(8) ]
  const witness = [...self.slice, ...other.slice, ...adderW, ...selfSerW, ...otherSerW];

  // abs bases
  const SELF_BASE = 0;            // self kernel slice @ 0..18
  const OTHER_BASE = Wk;          // other kernel slice @ 19..37
  const ADDER_BASE = 2 * Wk;      // adderW @ 38 ..
  const adderLen = adderW.length; // 1 + 4*N = 33
  const SELFSER_BASE = ADDER_BASE + adderLen;     // 8 items
  const OTHERSER_BASE = SELFSER_BASE + N;         // 8 items
  const totalW = OTHERSER_BASE + N;

  // KERNEL_SELF — the committed helper, reading its slice at the bottom (abs 0..18). When SELF runs the
  // stack is just the witness (no parked items yet), so its true start height == totalW; the committed
  // helper sets depth = W + extraAbove, so extraAbove = totalW - Wk.
  const extraAboveSelf = totalW - Wk;
  const kSelf = splitParentReconstructV2Ops(Mp, j, { tokenId: G, ownSPK, changeSPK, extraAbove: extraAboveSelf });
  if (kSelf.W !== Wk) throw new Error(`self kernel W ${kSelf.W} != ${Wk}`);

  // KERNEL_OTHER — relocatable copy reading its slice at abs 19..37 (base=19). When OTHER runs, SELF has
  // already pushed its 3 parked items (FROMALTSTACK x3) above the witness, so the true height = totalW + 3.
  const otherStartDepth = totalW + 3;
  const kOther = relocatableKernelOps(Mp, j, { tokenId: G, ownSPK, changeSPK, base: OTHER_BASE, startDepth: otherStartDepth });
  if (kOther.W !== Wk) throw new Error(`other kernel W ${kOther.W} != ${Wk}`);

  // After both kernels, main top (deepest->top of the parked block) =
  //   [.., ot_self, owner_self, amt_self, ot_other, owner_other, amt_other]
  // i.e. 6 parked items live above the witness. We now run conservation + welds.
  const ops = [...kSelf.ops, ...kOther.ops];

  // depth bookkeeping for the conservation/weld phase. After both kernels:
  //   stack = [ witness(totalW) , 6 parked items ]  => depth = totalW + 6
  let depth = totalW + 6;
  const DELTA = {
    [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_DUP]: 1, [O.OP_0]: 1, [O.OP_1]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1,
    [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2,
    [O.OP_SWAP]: 0, [O.OP_SHA256]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  // parked register absolute indices (they sit just above the witness, bottom->top in PARK order):
  //   ot_self @ totalW+0, owner_self @ +1, amt_self @ +2, ot_other @ +3, owner_other @ +4, amt_other @ +5
  const amtSelfAbs = totalW + 2, amtOtherAbs = totalW + 5;

  // --- WELD 1: OP_CAT(8 self b_ser limbs) == parked amount_in_self ---
  e(O.OP_0);
  for (let i = 0; i < N; i++) { pick(SELFSER_BASE + i); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); }
  e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);
  pick(amtSelfAbs); e(O.OP_EQUALVERIFY);
  // --- WELD 2: OP_CAT(8 other b_ser limbs) == parked amount_in_other ---
  e(O.OP_0);
  for (let i = 0; i < N; i++) { pick(OTHERSER_BASE + i); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); }
  e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);
  pick(amtOtherAbs); e(O.OP_EQUALVERIFY);

  // --- CONSERVATION: adderOps(N) proves amount_out == amount_in_self + amount_in_other. The adder reads
  //     its operands from the bottom adderW slice (committedSer + [a,b,s_num,s_ser] blocks LSB-first), which
  //     was welded above to the parked input amounts. The adder pops its own freshly-pushed copies, so we
  //     PICK-copy the adder witness to the top in the exact deepest->top order adderOps expects, then run it.
  //     adderOps' witness order on the stack (deepest->top) is: committedSer, then for i=N-1..0:
  //     a_i, b_i, s_num_i, s_ser_i. We re-push copies in that order.
  pick(ADDER_BASE); // committedSer copy (deepest of the adder's working slice)
  for (let i = N - 1; i >= 0; i--) {
    const blockBase = ADDER_BASE + 1 + (N - 1 - i) * 4; // adderW after committedSer: block for limb (N-1) first
    pick(blockBase + 0); // a_i
    pick(blockBase + 1); // b_i
    pick(blockBase + 2); // s_num_i
    pick(blockBase + 3); // s_ser_i
  }
  // adderOps consumes exactly (1 + 4N) items from the top and leaves [1].
  ops.push(...adderOps(N));
  depth = depth - (1 + 4 * N) + 1; // adder net: pops its witness, pushes OP_1
  // adder left a truthy [1] on top. Drop it + cleanstack everything for a clean terminal (so r.ok can be true).
  e(O.OP_DROP);
  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);
  ops.push(O.OP_1);

  const r = runScript(ops, witness, /*expectedSighash*/ null);

  // DIAGNOSTIC: peak of the TWO KERNELS ALONE (truncate the op stream right after the 2nd FROMALTSTACK x3
  // park, before any conservation). Comparing this to the full peak shows where the high-water actually sits
  // — i.e. whether the conservation/adder phase (full witness still resident) RAISES the peak, which is the
  // core faithfulness claim of this audit. We append a cleanstack so runScript can finish without abort.
  const kernelsOnly = [...kSelf.ops, ...kOther.ops];
  // park-block height after both kernels = totalW + 6; clean it down so the run terminates.
  const ko = [...kernelsOnly];
  for (let k = 0; k < totalW + 6; k++) ko.push(O.OP_DROP);
  ko.push(O.OP_1);
  let kernelsPeak = null;
  try { kernelsPeak = runScript(ko, witness, null).peakStack; } catch { /* ignore */ }

  return { r, witnessLen: witness.length, opLen: ops.length, parentLens: [self.preimageLen, other.preimageLen], kernelsPeak };
}

// =================================== RUN + REPORT ===================================
console.log('=== _audit_merge_peak: dual-backtrace MERGE peak-stack feasibility gate ===\n');

let split, dual;
try {
  split = baselineSplit();
  console.log('(1) BASELINE worst SPLIT leaf (Mp=4,j=3,M=4,gp=split-4, single backtrace):');
  console.log(`    ok=${split.r.ok}  peak_split=${split.r.peakStack}  trace_len=${split.r.trace.length}  witness_items=${split.witnessLen}`);
  console.log(`    final main depth=${split.r.main.length} alt depth=${split.r.alt.length}\n`);
} catch (err) {
  console.log(`(1) BASELINE threw: ${err.message}\n`);
}

try {
  dual = dualBacktrace();
  const maxElem = maxElemFromParents(dual.parentLens);
  console.log('(2)+(3)+(4) DUAL-BACKTRACE core (Mp=4,j=3 BOTH inputs, N=8, KEY; 2 kernels + conservation):');
  console.log(`    ok=${dual.r.ok}  peak_dual=${dual.r.peakStack}  trace_len=${dual.r.trace.length}`);
  console.log(`    witness_items(dual stream)=${dual.witnessLen}  op_count=${dual.opLen}  maxElem=${maxElem}B (largest = reconstructed parent tx preimage; scriptsim's 520B guard never fired)`);
  console.log(`    [where is the peak?] two-kernels-only peak=${dual.kernelsPeak}  vs full-dual peak=${dual.r.peakStack}  → the conservation/adder phase (full witness resident) ${dual.r.peakStack > dual.kernelsPeak ? `RAISES the peak by ${dual.r.peakStack - dual.kernelsPeak}` : 'does NOT raise the peak'}`);
  console.log(`    final main depth=${dual.r.main.length} alt depth=${dual.r.alt.length}\n`);
} catch (err) {
  console.log(`(2) DUAL threw at: ${err.message}`);
  console.log(err.stack.split('\n').slice(0, 4).join('\n'), '\n');
}

// (5) VERDICT
if (dual && dual.r) {
  const p = dual.r.peakStack, margin = 1000 - p;
  const reachedEnd = dual.r.ok; // ok=true ⟹ both EQUALVERIFY hash checks + both welds + adder all passed (no early abort)
  const verdictWord = p < 900 ? 'SAFE' : (p < 1000 ? 'MARGINAL' : 'OVER');
  console.log('(5) VERDICT:');
  console.log(`    peak_dual=${p} vs MAX_STACK_SIZE=1000  → margin=${margin} items  → ${verdictWord}`);
  console.log(`    faithful run? ${reachedEnd ? 'YES — ok=true: both kernel hash256 checks passed, both welds passed, adder passed (peak is REAL).' : 'PARTIAL — execution aborted before clean end; peak is the high-water at the abort point.'}`);
  if (split && split.r) console.log(`    (baseline single-backtrace peak_split=${split.r.peakStack}; dual adds the 2nd reconstruction + conservation.)`);
}
