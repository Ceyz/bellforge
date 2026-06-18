// P2-5 (mini) CONSENSUS — the OPERAND-TO-OUTPUT single-source binding enforced at block-validation: Σ(M outputs)==input AND
// each output's amount_ser_j (its stateOut value) is byte-identical to the value summed (the gadget welds b_num↔b_ser, so
// "adder sums A, state commits B" aborts). The GPT-build-review's #1 gate. Differential: scriptsim predicts, the node agrees.
// Run (regtest up): node --test native/p2_5_split_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenant, fund, notMinable, spendHex, destSpk } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { runScript } from './scriptsim.mjs';
import { splitBindMiniOps, splitBindMiniWitness } from './p2_5Covenant.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 split-bind consensus SKIPPED — ${skip}\n`);
const enc = bells.script.number.encode;

const covMN = {};
const covFor = (M, N) => (covMN[`${M}/${N}`] ||= makeCovenant(splitBindMiniOps(M, N)));

async function trySplit(M, N, witness, expectSim) {
  let sim; try { sim = runScript(splitBindMiniOps(M, N), witness).ok; } catch { sim = false; }
  assert.equal(sim, expectSim, `scriptsim prediction ${sim} != expected ${expectSim}`);
  const cov = covFor(M, N);
  const u = await fund(cov, 1);
  const dest = await destSpk();
  const hex = spendHex({ fundTxid: u.fundTxid, vout: u.vout, valueSats: u.valueSats, feeSats: 20000, destSpk: dest, witnessData: witness, cov });
  return (await notMinable(hex)).mined;
}

test('P2-5 mini: single-source split binding (Σ==input AND summed==state) at CONSENSUS — node agrees with scriptsim', { skip }, async () => {
  // GREEN — a conserving 2-way split, each amount_ser bound to its committed (state) value
  assert.equal(await trySplit(2, 8, splitBindMiniWitness([7_000_000n, 14_000_000n], 8), true), true, 'conserving 2-way split must mine');
  console.log('  GREEN M=2: Σ outputs == input, each amount_ser bound — accepted');
  // GREEN — 3-way split (the multi-valued carry path)
  assert.equal(await trySplit(3, 8, splitBindMiniWitness([7_000_000n, 9_500_000n, 4_500_000n], 8), true), true, 'conserving 3-way split must mine');
  console.log('  GREEN M=3: accepted');

  // RED-1a — THE single-source gate: out0 limb0 b_num=10 (summed) but b_ser=11 (→amount_ser/state). abs num=M+0=2, ser=3.
  const w1 = splitBindMiniWitness([10n, 5n], 8); w1[2] = enc(10); w1[3] = Buffer.from([11]);
  assert.equal(await trySplit(2, 8, w1, false), false, 'a divergent (b_num,b_ser) — summed 10 / state 11 — must be rejected by the gadget');
  console.log('  RED-1a summed≠state (gadget weld): rejected at block-validation');

  // RED-1b — state-mismatch: committed_0 claims 11 but output0 is 10 (amount_ser_0 != committed_0)
  assert.equal(await trySplit(2, 8, splitBindMiniWitness([10n, 5n], 8, { committedOverride: [11n, 5n] }), false), false, 'a stateOut committing a different amount than the output must be rejected');
  console.log('  RED-1b state≠built amount_ser: rejected at block-validation');

  // RED — INFLATION: outputs sum above the committed input
  assert.equal(await trySplit(2, 8, splitBindMiniWitness([7_000_001n, 14_000_000n], 8, { targetOverride: 21_000_000n }), false), false, 'Σ outputs > input must be rejected');
  console.log('  RED inflation (Σ out > input): rejected at block-validation');

  // RED — UNDER-COUNT: committed input above Σ outputs
  assert.equal(await trySplit(2, 8, splitBindMiniWitness([10n, 5n], 8, { targetOverride: 16n }), false), false, 'input > Σ outputs must be rejected');
  console.log('  RED under-count (input > Σ out): rejected at block-validation');

  // RED — >=2^63 top-limb gate
  assert.equal(await trySplit(2, 8, splitBindMiniWitness([(1n << 62n), (1n << 62n)], 8), false), false, 'a sum >= 2^63 must be rejected');
  console.log('  RED >=2^63 (top-limb gate): rejected at block-validation');
  console.log('\n✅ P2-5 mini: operand-to-output SINGLE-SOURCE binding (summed value == stateOut value) enforced at CONSENSUS.\n');
});
