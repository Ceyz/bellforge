// MERGE brick 1 — prove the GENERALIZED splitParentReconstructV2Ops composes with itself (the dual-backtrace core a K=2
// merge needs): TWO kernels on ONE stack, the second reading a base-shifted witness slice, BOTH hash256(txP)==committedTxidP
// EQUALVERIFY passing. This replaces the throwaway relocatable copy in _audit_merge_peak.mjs with the PRODUCTION kernel
// (base/startDepth params). Covers the tight-cap shape (Mp=1 transfer parent) AND the worst degree (Mp=4) for robustness.
//
// What this proves: (a) base>0 picks resolve to the right witness items (both reconstructions match), (b) the byte-identical
// base=0 default is intact (the existing v2 suite, run separately, stays 70/70), (c) the dual peak stays << MAX_STACK_SIZE=1000.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { splitParentReconstructV2Ops, splitParentV2Witness } from './p1e3SplitLineageV2.mjs';

const O = bells.opcodes;
const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (f) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, f)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);

// a real degree-Mp split parent (Mp=1 == a 1→1 transfer parent, the tight-cap merge-input shape) + the v2 kernel witness slice.
function buildParent(Mp, j, amountIn, owner_in, seed) {
  const kids = Array.from({ length: Mp }, (_, k) => ({
    value: 50000 + 1000 * k,
    amount: k === j ? BigInt(amountIn) : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k),
    ownerType: OwnerType.KEY,
  }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(seed)), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return {
    committedTxidP: hash256(legacy),
    slice: splitParentV2Witness({
      committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000,
      outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })),
    }),
  };
}

// compose KERNEL_SELF (base=0) ++ KERNEL_OTHER (base=Wk) ++ cleanstack, then run.
function composeTwoKernels(Mp) {
  const j = Mp - 1;                                   // spend the last child (worst pick depth)
  const owner_in = Buffer.alloc(20, 0x66);
  const self = buildParent(Mp, j, 14_000_000, owner_in, 0x42);
  const other = buildParent(Mp, j, 7_000_000, owner_in, 0x43);
  const Wk = 3 + 4 * Mp;
  const witness = [...self.slice, ...other.slice];
  const totalW = 2 * Wk;

  // KERNEL_SELF: slice at the bottom (base=0). At its start the stack is just the witness ⟹ height totalW;
  // the default depth = Wk + extraAbove, so extraAbove = totalW - Wk.
  const kSelf = splitParentReconstructV2Ops(Mp, j, { tokenId: G, ownSPK, changeSPK, extraAbove: totalW - Wk });
  // KERNEL_OTHER: slice at base=Wk. When it starts, SELF has parked 3 registers (FROMALTSTACK x3) above the witness ⟹
  // true height totalW + 3, passed explicitly via startDepth.
  const kOther = splitParentReconstructV2Ops(Mp, j, { tokenId: G, ownSPK, changeSPK, base: Wk, startDepth: totalW + 3 });
  assert.equal(kSelf.W, Wk); assert.equal(kOther.W, Wk);

  // after both kernels main = [witness(totalW), 6 parked]; clean to a single truthy [1].
  const ops = [...kSelf.ops, ...kOther.ops];
  for (let k = 0; k < totalW + 6; k++) ops.push(O.OP_DROP);
  ops.push(O.OP_1);
  return runScript(ops, witness, null);
}

test('MERGE brick1: two PRODUCTION kernels compose at Mp=1 (tight-cap transfer parent) — both hash256 checks pass', () => {
  const r = composeTwoKernels(1);
  assert.equal(r.ok, true, 'both Mp=1 kernel reconstructions hash-match (base-shifted picks resolve correctly)');
  assert.ok(r.peakStack > 0 && r.peakStack < 1000, `Mp=1 dual peak ${r.peakStack} < 1000`);
});

test('MERGE brick1: two PRODUCTION kernels compose at Mp=4 (worst degree) — both hash256 checks pass', () => {
  const r = composeTwoKernels(4);
  assert.equal(r.ok, true, 'both Mp=4 kernel reconstructions hash-match');
  assert.ok(r.peakStack > 0 && r.peakStack < 1000, `Mp=4 dual peak ${r.peakStack} < 1000`);
});

test('MERGE brick1: a wrong startDepth (off by the parked-register count) fails — startDepth is load-bearing', () => {
  // KERNEL_OTHER at the CORRECT base=Wk but with startDepth=totalW (omitting SELF's 3 parked registers) ⟹ every pick is
  // offset by 3 ⟹ it reads wrong-width items ⟹ an OP_SIZE/EQUALVERIFY aborts. Proves startDepth must count the items above.
  const Mp = 1, j = 0;
  const owner_in = Buffer.alloc(20, 0x66);
  const self = buildParent(Mp, j, 14_000_000, owner_in, 0x42);
  const other = buildParent(Mp, j, 7_000_000, owner_in, 0x43);
  const Wk = 3 + 4 * Mp, totalW = 2 * Wk;
  const kSelf = splitParentReconstructV2Ops(Mp, j, { tokenId: G, ownSPK, changeSPK, extraAbove: totalW - Wk });
  const kBad = splitParentReconstructV2Ops(Mp, j, { tokenId: G, ownSPK, changeSPK, base: Wk, startDepth: totalW }); // WRONG: ignores the 3 parked
  const ops = [...kSelf.ops, ...kBad.ops];
  for (let k = 0; k < totalW + 6; k++) ops.push(O.OP_DROP);
  ops.push(O.OP_1);
  let threw = false, ok = null;
  try { ok = runScript(ops, [...self.slice, ...other.slice], null).ok; } catch { threw = true; }
  assert.ok(threw || ok === false, 'a wrong startDepth must not validate (picks resolve to wrong-width items ⟹ abort)');
});
