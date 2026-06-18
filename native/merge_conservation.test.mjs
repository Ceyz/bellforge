// MERGE brick 2a — the conservation KEYSTONE, tested in ISOLATION (like amounts_nway_consensus): amt_self + amt_other == amount_out
// over base-256 byte-limbs, with the OPERANDS welded to the backtrace-parked amounts (the soundness crux: a free operand = mint-from-
// nothing). scriptsim dry-run (the arithmetic + gadget + welds all execute in sim; consensus is proven separately for these opcodes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { mergeConservationOps, mergeConservationWitness, amountLimbsN } from './amounts.mjs';

const O = bells.opcodes;
const N = 8;

// run the conservation gadget over a witness; it leaves the stack UNCHANGED (verify gadget), so append cleanstack+OP_1 for r.ok.
function run(witness) {
  const { ops, W } = mergeConservationOps(N);
  assert.equal(W, witness.length, `witness length ${witness.length} != W ${W}`);
  const full = [...ops];
  for (let k = 0; k < W; k++) full.push(O.OP_DROP);
  full.push(O.OP_1);
  return runScript(full, witness, null);
}
const ok = (w) => { let r, threw = false; try { r = run(w); } catch { threw = true; } return !threw && r.ok === true; };

test('merge-conservation GREEN: 14M + 7M == 21M', () => {
  assert.equal(ok(mergeConservationWitness(14_000_000n, 7_000_000n, N)), true);
});

test('merge-conservation GREEN: differential over carry-inducing + edge pairs', () => {
  const pairs = [
    [0n, 0n], [0n, 21_000_000n], [255n, 255n], [256n, 256n], [200n, 100n],     // limb0 carry
    [65535n, 1n], [(1n << 32n) - 1n, 1n], [123456789n, 987654321n],            // multi-limb carry
    [(1n << 62n) - 1n, 1n],                                                     // just under 2^62
    [(1n << 62n), (1n << 62n) - 1n],                                           // sum = 2^63 - 1 (max allowed, MSB=0x7f)
  ];
  for (const [a, b] of pairs) assert.equal(ok(mergeConservationWitness(a, b, N)), true, `${a}+${b} should conserve`);
});

test('merge-conservation RED inflation: amount_out forged > self+other rejects', () => {
  // operands honest (14M, 7M) but committedOut/out limbs forged to 999M ⟹ the per-limb sum r != out_num ⟹ NUMEQUALVERIFY abort.
  assert.equal(ok(mergeConservationWitness(14_000_000n, 7_000_000n, N, { outOverride: 999_000_000n })), false);
});

test('merge-conservation RED operand DECOUPLING (the crux): an internally-consistent INFLATED operand still rejects', () => {
  // Build a fully self-consistent witness for an INFLATED self=999M (so the gadget AND the self+other==out sum both pass),
  // then overwrite ONLY the parked amt_self @ index 0 with the REAL backtraced 14M. The operand weld OP_CAT(self_ser)==amt_self
  // must catch it — proving the operand is BOUND to the parked amount, not a free witness (this is the anti-inflation guarantee).
  const w = mergeConservationWitness(999_000_000n, 7_000_000n, N); // self limbs + out are all 999M+7M-consistent
  w[0] = Buffer.from(amountLimbsN(14_000_000n, N));                // amt_self := the honest parked 14M (≠ the 999M operand limbs)
  assert.equal(ok(w), false, 'a 999M operand against a 14M parked amount must reject at the self weld');
});

test('merge-conservation RED overflow/wrap: self+other == 2^63 rejects (MSB gate amount_out < 2^63)', () => {
  assert.equal(ok(mergeConservationWitness(1n << 62n, 1n << 62n, N)), false); // sum = 2^63 ⟹ top limb 0x80 ⟹ r<128 fails
});

test('merge-conservation RED gadget inconsistency: a limb (num,ser) mismatch rejects', () => {
  const w = mergeConservationWitness(14_000_000n, 7_000_000n, N);
  // self limb 0 lives at witness index 3 (num) / 4 (ser). Corrupt the ser to a value inconsistent with the num.
  w[4] = Buffer.from([(w[3].length ? w[3][0] : 0) ^ 0x55 | 0x01]);  // a byte that won't match the num's encoding
  assert.equal(ok(w), false, 'a loose b_ser↔b_num tie must reject (the CAT20 re-entry point)');
});
