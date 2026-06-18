// P2-0 FREEZE — de-circularize the descriptor. freezeDeploy DERIVES transferSPK from the complete leaf set (the taptree root), so
// genesis out0 == transferSPK PROVES out0 commits to EXACTLY that enumerated leaf set (not a trusted passed param). Asserts: the
// derived SPK matches an independent buildTaptree recompute (2nd-validator); a mint built TO that SPK passes selfValidateAtGenesis;
// a tampered root is caught by assertLeafCoverage; TIER-MIN commits a different set ⟹ a different address. Run: node --test native/p4/freeze_deploy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64 } from '../sighashParts.mjs';
import { buildTaptree } from '../freezeEnumerate.mjs';
import { freezeDeploy, assertLeafCoverage, selfValidateAtGenesis } from './deploy.mjs';
import { monoGenesisTx } from '../p1e3MonoGenesisV2.mjs';

const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const params = { tokenId: Buffer.alloc(36, 0xab), AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n, feeOut: Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]), changeSpkLen: 34 };

test('freezeDeploy DERIVES transferSPK from the leaf set (== an independent buildTaptree recompute)', () => {
  const deploy = freezeDeploy(params);
  assert.equal(deploy.wireVersion, 'v2');
  assert.deepEqual(deploy.arms, ['key', 'script']);
  const independent = buildTaptree(deploy.consts, { arms: ['key', 'script'] }).transferSPK;
  assert.ok(deploy.transferSPK.equals(independent), 'descriptor SPK == the re-derived leaf-set root (de-circularized)');
  assertLeafCoverage(deploy); // no throw
});

test('a genesis mint built TO the derived SPK passes selfValidateAtGenesis (out0 == leaf-set root ⟹ coverage proven)', () => {
  const deploy = freezeDeploy(params);
  const { tx } = monoGenesisTx({ ...params, ownSPK: deploy.transferSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp: p2tr(0x88) });
  const mint = bells.Transaction.fromBuffer(tx);
  assert.ok(mint.outs[0].script.equals(deploy.transferSPK), 'mint out0 == the covenant taptree address');
  selfValidateAtGenesis(deploy, mint); // no throw — isGenesisTemplate (v2 stateOut0) ∧ out0==derived root
});

test('RED de-circularization: a tampered transferSPK fails assertLeafCoverage (a wrong/under-covered root is caught)', () => {
  const deploy = freezeDeploy(params);
  const bad = { ...deploy, transferSPK: p2tr(0xee) };
  assert.throws(() => assertLeafCoverage(bad), /re-derived leaf-set root/);
  // and a mint to the tampered SPK no longer matches the genesis template (out0 mismatch).
  const { tx } = monoGenesisTx({ ...params, ownSPK: p2tr(0xee), mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp: p2tr(0x88) });
  assert.throws(() => selfValidateAtGenesis(deploy, bells.Transaction.fromBuffer(tx)), /HALT/);
});

test('TIER-MIN (KEY-only) commits a DIFFERENT leaf set ⟹ a DIFFERENT covenant address', () => {
  const full = freezeDeploy({ ...params, arms: ['key', 'script'] });
  const min = freezeDeploy({ ...params, arms: ['key'] });
  assert.ok(!full.transferSPK.equals(min.transferSPK), 'TIER-FULL (404) and TIER-MIN (204) are distinct, committed addresses');
  assertLeafCoverage(min); // the KEY-only root self-consistent
});
