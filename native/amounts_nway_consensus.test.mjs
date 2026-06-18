// P2-1 (N-way) CONSENSUS — the SPLIT/MERGE conservation Σ(M outputs) == input enforced at block-validation, with the bounded
// multi-valued carry (no OP_DIV/MOD). Differential: scriptsim + the off-chain sum predict; the node agrees. The anti-inflation
// core for a real split. Run (regtest up): node --test native/amounts_nway_consensus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCovenant, fund, notMinable, spendHex, destSpk } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { runScript } from './scriptsim.mjs';
import { nwayConservationOps, nwayWitness } from './amounts.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-1 N-way consensus SKIPPED — ${skip}\n`);

const covMN = {};
const covFor = (M, N) => (covMN[`${M}/${N}`] ||= makeCovenant(nwayConservationOps(M, N)));

async function tryNway(M, N, witness, expectSim) {
  // dry-run first (scriptsim now models the arithmetic) — must agree with the consensus outcome
  let sim; try { sim = runScript(nwayConservationOps(M, N), witness).ok; } catch { sim = false; }
  assert.equal(sim, expectSim, `scriptsim prediction mismatch (got ${sim}, want ${expectSim})`);
  const cov = covFor(M, N);
  const u = await fund(cov, 1);
  const dest = await destSpk();
  const hex = spendHex({ fundTxid: u.fundTxid, vout: u.vout, valueSats: u.valueSats, feeSats: 20000, destSpk: dest, witnessData: witness, cov });
  return (await notMinable(hex)).mined;
}

test('P2-1 N-way (M=3) CONSENSUS: Σ outputs == input ACCEPTS; inflation/under-count REJECTS — node agrees with scriptsim', { skip }, async () => {
  const outs = [7_000_000n, 9_500_000n, 4_500_000n]; // Σ = 21,000,000

  // GREEN — a conserving 3-way split (carries propagate across several limbs)
  assert.equal(await tryNway(3, 8, nwayWitness(outs, 8), true), true, 'a conserving 3-way split must mine');
  console.log('  GREEN M=3: Σ outputs == input, accepted at consensus');

  // RED — INFLATION: the outputs sum to MORE than the committed input (claim 21,000,000 but spend 21,000,001 in outputs)
  assert.equal(await tryNway(3, 8, nwayWitness([7_000_001n, 9_500_000n, 4_500_000n], 8, { targetOverride: 21_000_000n }), false), false, 'outputs summing above the input must be rejected');
  console.log('  RED inflation (Σ outputs > input): rejected at block-validation');

  // RED — UNDER-COUNT: the committed input claims MORE than Σ outputs (would strand/burn value, and lets a forged input amount slip)
  assert.equal(await tryNway(3, 8, nwayWitness(outs, 8, { targetOverride: 21_000_001n }), false), false, 'a committed input above Σ outputs must be rejected');
  console.log('  RED under-count (input > Σ outputs): rejected at block-validation');

  // RED — >=2^63 via the top-limb gate: outputs summing to exactly 2^63
  const big = [(1n << 62n), (1n << 62n)]; // Σ = 2^63
  assert.equal(await tryNway(2, 8, nwayWitness(big, 8), false), false, 'a sum >= 2^63 must be rejected by the top-limb gate');
  console.log('  RED >=2^63 (top-limb gate): rejected at block-validation');
  console.log('\n✅ P2-1 N-way: split/merge conservation (Σ == input, no inflation, <2^63) enforced at CONSENSUS.\n');
});
