// sellPoolOutputsBuildOps — the SELL output topology built on-stack matches the off-chain set (pool note' + pool stateOut(x') +
// trader BELLS payout + change). GREEN: byte-exact. RED: a tampered output mismatches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from './scriptsim.mjs';
import { sellPoolOutputsBuildOps, sellPoolOutputs } from './buyLeaf.mjs';
import { u64 } from './sighashParts.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);
const p2tr = (s) => Buffer.concat([h('5120'), x32(s)]);

const poolSPK = p2tr(7), traderSPK = p2tr(2), changeSPK = p2tr(3), poolOwner = Buffer.alloc(20, 5);
const yp = 51_000_000n, xp = 1000n, bellsOut = 33_000_000n, changeVal = 1000n;
const { shaOutputs } = sellPoolOutputs({ yp, poolSPK, xp, poolOwner, bellsOut, traderSPK, changeVal, changeSPK });
const { ops } = sellPoolOutputsBuildOps();
const w = () => [u64(yp), poolSPK, u64(xp), poolOwner, u64(bellsOut), traderSPK, u64(changeVal), changeSPK, shaOutputs];

test('sellPoolOutputs — the SELL output topology builds byte-exact (pool note\' + stateOut(x\') + trader BELLS + change)', () => {
  assert.doesNotThrow(() => runScript(ops, w()), 'on-stack SELL shaOutputs must == the off-chain set');
});

test('sellPoolOutputs RED — a tampered output (y\') breaks the match', () => {
  const bad = w(); bad[0] = u64(yp + 1n);
  assert.throws(() => runScript(ops, bad), /EQUALVERIFY/, 'a tampered output must mismatch');
});
