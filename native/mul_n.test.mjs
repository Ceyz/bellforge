// mulN — schoolbook long-multiply composing chunkMul (16×8 radix, single-sourced, hoisted bit-verify, witnessed-div normalize).
// GREEN proves: (1) Σ resultLimb_p·256^p == a·b across uint16²/uint32²/uint64² for a spread of operands, and (2) forged witnesses
// (bad q/r, out-of-range r, forged bits) HALT. The product limbs come back on the alt stack; the test reconstructs and compares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { mulNOps, mulNWitness, mulNRef, bitsOf } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const dec = (b) => bells.script.number.decode(b, 4, true);

const limbs16 = (a, na) => { const o = []; let x = BigInt(a); for (let i = 0; i < na; i++) { o.push(Number(x & 0xffffn)); x >>= 16n; } return o; };
const limbs8 = (b, nb) => { const o = []; let x = BigInt(b); for (let j = 0; j < nb; j++) { o.push(Number(x & 0xffn)); x >>= 8n; } return o; };

// run mulN(na,nb) for BigInts a,b; return the reconstructed product from the alt-stack result limbs.
function runMulN(a, b, na, nb, witnessOverride) {
  const A = limbs16(a, na), B = limbs8(b, nb);
  const { ops } = mulNOps(na, nb);
  const r = runScript(ops, witnessOverride ?? mulNWitness(A, B));
  let recon = 0n;
  r.alt.forEach((limb, p) => { recon += BigInt(dec(limb)) << BigInt(8 * p); });
  return { recon, peakStack: r.peakStack, opCount: ops.filter((x) => !Buffer.isBuffer(x)).length };
}

function diff(na, nb, samples) {
  const aMax = (1n << BigInt(16 * na)) - 1n, bMax = (1n << BigInt(8 * nb)) - 1n;
  for (const [a, b] of samples) {
    assert.ok(a <= aMax && b <= bMax, `sample out of width for ${na}x${nb}`);
    const { recon } = runMulN(a, b, na, nb);
    assert.equal(recon, a * b, `mulN ${na}x${nb}: ${a}·${b} = ${a * b}, got ${recon}`);
  }
}

test('mulN 1×2 — uint16 × uint16 → uint32', () => {
  diff(1, 2, [[0n, 0n], [1n, 1n], [255n, 255n], [256n, 256n], [0xffffn, 0xffffn], [12345n, 6789n], [0xffffn, 1n], [1n, 0xffffn], [0n, 0xffffn]]);
});

test('mulN 2×4 — uint32 × uint32 → uint64', () => {
  diff(2, 4, [[0n, 0n], [1n, 1n], [0xffffffffn, 0xffffffffn], [0x12345678n, 0x9abcdef0n], [0xffffffffn, 1n], [0x10000n, 0x10000n], [0xdeadbeefn, 0xcafef00dn]]);
});

test('mulN 4×8 — uint64 × uint64 → uint128 (the AMM reserve width)', () => {
  const M = (1n << 64n) - 1n;
  diff(4, 8, [[0n, 0n], [1n, 1n], [M, M], [M, 1n], [1n, M], [0x123456789abcdef0n, 0x0fedcba987654321n], [1000000000000n, 999999999999n], [1n << 63n, 2n]]);
});

test('mulN RED — forged remainder (tampered r_p) is rejected', () => {
  const na = 2, nb = 4, A = limbs16(0x12345678n, na), B = limbs8(0x9abcdef0n, nb);
  const w = mulNWitness(A, B);
  const { nr } = mulNOps(na, nb);
  const Qbase = na + nb + nb * 8;
  w[Qbase + 1] = enc(dec(w[Qbase + 1]) + 1);     // bump r_0 by 1 ⟹ val != q·256+r
  assert.throws(() => runScript(mulNOps(na, nb).ops, w), /NUMEQUALVERIFY/, 'tampered r_0 must HALT at the div check');
});

test('mulN RED — out-of-range remainder (r_0+=256, q_0-=1 keeps q·256+r but r≥256) is rejected', () => {
  const na = 2, nb = 4, A = limbs16(0x12345678n, na), B = limbs8(0x9abcdef0n, nb);
  const w = mulNWitness(A, B);
  const Qbase = na + nb + nb * 8;
  w[Qbase] = enc(dec(w[Qbase]) - 1);             // q_0 -= 1
  w[Qbase + 1] = enc(dec(w[Qbase + 1]) + 256);   // r_0 += 256  (q·256+r unchanged, but r out of [0,256))
  assert.throws(() => runScript(mulNOps(na, nb).ops, w), /VERIFY|WITHIN/, 'r>=256 must HALT at 0<=r<256 (non-canonical limb)');
});

test('mulN RED — forged bit-decomposition (B_0 bits) is rejected', () => {
  const na = 2, nb = 4, A = limbs16(0x12345678n, na), B = limbs8(0x9abcdef0n, nb);
  const w = mulNWitness(A, B);
  const bit0 = na + nb;                           // first bit of B_0
  const flip = (b) => (b.length === 0 ? Buffer.from([1]) : Buffer.alloc(0));
  w[bit0] = flip(w[bit0]);                        // flip B_0's bit_0 ⟹ Σ != B_0
  assert.throws(() => runScript(mulNOps(na, nb).ops, w), /NUMEQUALVERIFY/, 'forged bits must HALT at the hoisted Σ==B_j check');
});

test('mulN — BUDGET (op count, peak stack, witness size) at the uint64² width', () => {
  const M = (1n << 64n) - 1n;
  const { recon, peakStack, opCount } = runMulN(M, M, 4, 8);
  const { Wtotal, nFat, nr } = mulNOps(4, 8);
  console.log(`\n  [mulN 4×8 budget] ops=${opCount}  peakStack=${peakStack}  witnessItems=${Wtotal}  fatLimbs=${nFat}  resultLimbs=${nr}  product(2^64-1)²=${recon}`);
  assert.equal(recon, M * M);
  assert.ok(peakStack < 1000, `peak stack ${peakStack} must stay < MAX_STACK_SIZE 1000`);
});
