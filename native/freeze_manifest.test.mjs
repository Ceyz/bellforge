// audit Result-6 (independent root) + O (freeze manifest). PURE. Run: node --test native/freeze_manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { u64 } from './sighashParts.mjs';
import { buildTaptree, enumerateLeaves, NUMS } from './freezeEnumerate.mjs';
import { freezeDeploy } from './p4/deploy.mjs';
import { independentTransferSPK, independentOutputKey, NUMS_INDEP } from './independentRoot.mjs';
import { buildFreezeManifest, renderManifestMarkdown } from './freezeManifest.mjs';

const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const params = { tokenId: Buffer.alloc(36, 0xab), AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n, feeOut: Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]), changeSpkLen: 34 };

test('Result-6: the INDEPENDENT root re-derivation byte-agrees with buildTaptree (TIER-FULL + TIER-MIN)', () => {
  for (const arms of [['key', 'script'], ['key']]) {
    const deploy = freezeDeploy({ ...params, arms });
    const leaves = enumerateLeaves(deploy.consts, { arms });
    const prod = buildTaptree(deploy.consts, { arms }).transferSPK;
    const indep = independentTransferSPK(leaves);
    assert.ok(prod.equals(indep), `independent root agrees for [${arms}]`);
    assert.ok(prod.equals(deploy.transferSPK), 'and equals the deploy transferSPK');
  }
  assert.ok(NUMS.equals(NUMS_INDEP), 'independently re-derived NUMS == the production NUMS const');
});

test('R: NUMS lifts to a valid x-only point + the FROZEN control-block parity matches the independent tweak', () => {
  // lift_x(NUMS) succeeds — a curve point exists with x==NUMS (BIP-340 even-Y lift); a non-liftable NUMS would throw here.
  const t0 = bells.crypto.taggedHash('TapTweak', Buffer.concat([NUMS_INDEP, Buffer.alloc(32)]));
  const lifted = ecc.xOnlyPointAddTweak(NUMS_INDEP, t0);
  assert.ok(lifted && lifted.xOnlyPubkey && lifted.xOnlyPubkey.length === 32, 'NUMS is a liftable x-only point');
  // control-block parity cross-check: the independently-computed output-key parity == the production cb parity bit.
  const arms = ['key', 'script'];
  const deploy = freezeDeploy({ ...params, arms });
  const tree = buildTaptree(deploy.consts, { arms });
  const ind = independentOutputKey(enumerateLeaves(deploy.consts, { arms }));
  assert.ok(ind.spk.equals(tree.transferSPK), 'independent output key == production transferSPK');
  const sample = tree.ordered.find((l) => l.id.fam === 'split' && l.id.gp === 'split' && l.id.Mp_gp === 4 && l.id.M === 4 && l.id.arm === 'script');
  const cb = tree.controlBlockFor(sample.leaf);
  assert.equal(cb[0] & 1, ind.parity, 'frozen control-block parity bit == the independently-recomputed output-key parity (no belcoinjs parity/merkle drift)');
});

test('Result-6: the independent root is SENSITIVE — a dropped leaf changes it', () => {
  const deploy = freezeDeploy({ ...params, arms: ['key', 'script'] });
  const leaves = enumerateLeaves(deploy.consts, { arms: ['key', 'script'] });
  assert.ok(!independentTransferSPK(leaves).equals(independentTransferSPK(leaves.slice(1))), 'dropping a leaf moves the root');
});

test('O: the freeze manifest captures the permanent decisions; roots + NUMS agree; policy TBDs present', () => {
  const m = buildFreezeManifest(freezeDeploy({ ...params, arms: ['key', 'script'] }));
  assert.equal(m.root.rootsAgree, true);            // production == independent re-derivation
  assert.equal(m.nums.numsAgree, true);
  assert.equal(m.root.leafCount, 490);              // 404 + 86 merge family
  assert.equal(m.root.tier, 'TIER-FULL');
  assert.equal(m.policy.TOKEN_VALUE_MIN, '546');
  assert.match(m.policy.dustFloor, /DECIDED/);      // root-bytes decisions LOCKED 2026-06-15 (off-chain 546)
  assert.match(m.policy.merge, /DECIDED/);          // BUILD K=2 (now enumerated into the root)
  assert.match(m.policy.controllerPolicy, /TBD/);   // controller deposit-layer policy still open
  assert.match(m.build.activationProof, /TBD/);
  assert.ok(renderManifestMarkdown(m).includes('FREEZE MANIFEST'));
  // TIER-MIN excludes SCRIPT => controller policy n/a, 250 leaves.
  const mMin = buildFreezeManifest(freezeDeploy({ ...params, arms: ['key'] }));
  assert.equal(mMin.root.leafCount, 250);
  assert.match(mMin.policy.controllerPolicy, /n\/a/);
});
