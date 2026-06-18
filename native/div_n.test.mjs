// divN — Euclidean division D = q·d + r (0≤r<d, d≠0) via the seeded-accumulator mulN + target-assert. GREEN proves the gadget
// ACCEPTS the true (q,r) for a spread of (D,d) and REJECTS forged quotient/remainder, r≥d, and d=0. na/nd/nD = uint64 / uint16 / uint64.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { divNOps, divNWitness, divNRef } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const dec = (b) => bells.script.number.decode(b, 4, true);
const NA = 4, ND = 2, NDIV = 8;                          // q uint64, d uint16, D uint64

const accept = (D, d) => assert.doesNotThrow(() => runScript(divNOps(NA, ND, NDIV).ops, divNWitness(D, d, NA, ND, NDIV)), `D=${D} d=${d} must divide`);

test('divN — accepts the true Euclidean (q,r) across a spread', () => {
  const cases = [[100n, 7n], [0n, 1n], [1n, 1n], [65535n, 65535n], [(1n << 64n) - 1n, 65535n], [(1n << 64n) - 1n, 1n],
                 [1000000000000n, 10000n], [123456789n, 1000n], [(1n << 63n), 2n], [(1n << 64n) - 1n, 7n]];
  for (const [D, d] of cases) {
    const { q, r, check } = divNRef(D, d);
    assert.ok(check, `ref ${D}/${d}`);
    accept(D, d);
  }
});

test('divN — concrete: 100 / 7 = 14 r 2', () => {
  const { q, r } = divNRef(100n, 7n);
  assert.equal(q, 14n); assert.equal(r, 2n);
  accept(100n, 7n);
});

test('divN RED — forged quotient (q+1) is rejected', () => {
  const D = 1000000000000n, d = 10000n;
  const w = divNWitness(D, d, NA, ND, NDIV);
  w[0] = enc(dec(w[0]) + 1);                              // bump q limb 0 ⟹ q·d+r ≠ D
  assert.throws(() => runScript(divNOps(NA, ND, NDIV).ops, w), /NUMEQUALVERIFY/, 'q+1 must HALT at result==D');
});

test('divN RED — forged remainder (r := d, i.e. not reduced) is rejected', () => {
  // true: 100/7 = 14 r 2. Forge q=14, r=7 (so q·d+r = 98+7 = 105 ≠ 100, AND r≥d). Tamper both q-side? simplest: set r=d ⟹ r<d fails.
  const D = 100n, d = 7n;
  const w = divNWitness(D, d, NA, ND, NDIV);
  const rBase = NA + ND + NDIV;                           // r limbs start
  w[rBase] = enc(d === 0n ? 0 : 7);                       // r_0 := 7 == d ⟹ r<d violated
  assert.throws(() => runScript(divNOps(NA, ND, NDIV).ops, w), /VERIFY/, 'r≥d must HALT at r<d');
});

test('divN RED — divisor zero is rejected', () => {
  // build a witness for d=1 then zero the divisor limbs + its bits ⟹ d=0 path.
  const w = divNWitness(49n, 1n, NA, ND, NDIV);
  const bBase = NA;                                       // d limbs
  w[bBase] = enc(0);                                      // d_0 := 0 (d_1 already 0) ⟹ d = 0
  // also zero d_0's bits so the (now Σ=0) bit-verify is internally consistent; the d≠0 guard should fire first.
  const bitBase = NA + ND + NDIV + ND;
  for (let k = 0; k < 8; k++) w[bitBase + k] = Buffer.alloc(0);
  assert.throws(() => runScript(divNOps(NA, ND, NDIV).ops, w), /VERIFY/, 'd=0 must HALT');
});

test('divN — BUDGET (uint64 / uint16)', () => {
  const { ops, opCount, Wtotal, nResult } = divNOps(NA, ND, NDIV);
  const r = runScript(ops, divNWitness((1n << 64n) - 1n, 7n, NA, ND, NDIV));
  console.log(`\n  [divN u64/u16 budget] ops=${opCount}  peakStack=${r.peakStack}  witnessItems=${Wtotal}  resultLimbs=${nResult}`);
  assert.ok(r.peakStack < 1000);
});
