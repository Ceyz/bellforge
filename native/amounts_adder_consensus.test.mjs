// P2-1 CONSENSUS — the base-256 byte-limb ADDER enforced at block-validation. Proves Σ conservation (A+B==S) with carry
// propagation, the BIND tie (summed value == serialized value via the gadget), the top-limb carry-out==0 (no overflow), and
// the <2^(8N−1) gate — and that OP_ADD/OP_SUB/OP_GREATERTHANOREQUAL execute (not OP_SUCCESSx). Differential: the off-chain
// addLimbsRef predicts; the node agrees. Run (regtest up): node --test native/amounts_adder_consensus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCovenant, fund, notMinable, spendHex, destSpk } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { adderOps, adderWitness, addLimbsRef } from './amounts.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-1 adder consensus SKIPPED — ${skip}\n`);

const limbsOf = (v, N) => { const x = BigInt(v); const a = []; for (let i = 0; i < N; i++) a.push(Number((x >> BigInt(8 * i)) & 0xffn)); return a; };
const covN = {};
const covFor = (N) => (covN[N] ||= makeCovenant(adderOps(N)));

async function tryAdder(N, aLimbs, bLimbs, sumLimbs) {
  const cov = covFor(N);
  const u = await fund(cov, 1);
  const dest = await destSpk();
  const hex = spendHex({ fundTxid: u.fundTxid, vout: u.vout, valueSats: u.valueSats, feeSats: 20000, destSpk: dest, witnessData: adderWitness(aLimbs, bLimbs, sumLimbs), cov });
  return (await notMinable(hex)).mined;
}

test('P2-1 N=2 GREEN: limb add WITH carry propagation across the 1 carry boundary', { skip }, async () => {
  // no-carry
  let a = limbsOf(0x0102, 2), b = limbsOf(0x0203, 2), { sumLimbs, carryOut } = addLimbsRef(a, b);
  assert.equal(carryOut, 0);
  assert.equal(await tryAdder(2, a, b, sumLimbs), true, 'N=2 no-carry must mine');
  console.log('  GREEN N=2 (no carry): accepted');
  // with-carry (limb0 overflows into limb1)
  a = limbsOf(0x01ff, 2); b = limbsOf(0x0002, 2); ({ sumLimbs, carryOut } = addLimbsRef(a, b));
  assert.equal(carryOut, 0);
  assert.equal(await tryAdder(2, a, b, sumLimbs), true, 'N=2 with-carry must mine');
  console.log('  GREEN N=2 (carry limb0->limb1): accepted — carry threading works');
});

test('P2-1 N=8 GREEN + RED battery: conservation, BIND, no-overflow, <2^63 all enforced at CONSENSUS', { skip }, async () => {
  // GREEN — a real conserving sum
  const A = 21_000_000n, B = 123_456_789n;
  let a = limbsOf(A, 8), b = limbsOf(B, 8), { sumLimbs } = addLimbsRef(a, b);
  assert.equal(await tryAdder(8, a, b, sumLimbs), true, 'honest 8-limb sum must mine');
  console.log('  GREEN N=8: A+B conserved, accepted');

  // RED — WRONG SUM (one result limb off by one): r != s_num -> reject
  const bad = sumLimbs.slice(); bad[3] = (bad[3] + 1) & 0xff;
  assert.equal(await tryAdder(8, a, b, bad), false, 'a wrong result limb must be rejected');
  console.log('  RED wrong-sum: rejected at block-validation');

  // RED — IGNORED CARRY: supply per-limb (a_i+b_i)&0xff with NO carry propagation -> mismatch where the carry was due
  const ca = limbsOf(0x00000000000000ffn, 8), cb = limbsOf(0x0000000000000001n, 8); // limb0 overflows
  const ignored = ca.map((x, i) => (x + cb[i]) & 0xff); // = [0x00, 0x00, ...] (true is [0x00, 0x01, 0...])
  assert.equal(await tryAdder(8, ca, cb, ignored), false, 'ignoring the carry must be rejected');
  console.log('  RED ignored-carry: rejected at block-validation');

  // RED — OVERFLOW past 2^64 (final carry-out != 0): top limbs 0x80+0x80 -> carry out, result fits but overflows uint64
  const oa = limbsOf(1n << 63n, 8), ob = limbsOf(1n << 63n, 8); // 2^63 + 2^63 = 2^64
  const ov = addLimbsRef(oa, ob); assert.equal(ov.carryOut, 1);
  assert.equal(await tryAdder(8, oa, ob, ov.sumLimbs), false, 'a sum overflowing uint64 (final carry) must be rejected');
  console.log('  RED overflow (final carry-out): rejected at block-validation');

  // RED — SUM >= 2^63 (the top-limb <128 gate): 2^63-1 + 1 = 2^63, top limb = 0x80
  const ga = limbsOf((1n << 63n) - 1n, 8), gb = limbsOf(1n, 8);
  const gv = addLimbsRef(ga, gb); assert.equal(gv.carryOut, 0); assert.equal(gv.sumLimbs[7], 0x80);
  assert.equal(await tryAdder(8, ga, gb, gv.sumLimbs), false, 'a sum >= 2^63 must be rejected by the top-limb gate');
  console.log('  RED >=2^63 (top-limb gate): rejected at block-validation');
  console.log('\n✅ P2-1: the base-256 byte-limb adder enforces conservation + BIND + no-overflow + <2^63 at CONSENSUS.\n');
});
