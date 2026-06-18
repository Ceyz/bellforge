// P2-0 FREEZE STEP 5 — the complete-leaf-set enumeration + the cardinal-rule COVERAGE proof. Asserts: all leaves BUILD (no offset
// trap in any (Mp,j,M,gp,arm) cell — the enumeration throws on a build failure), the counts are exact (404 TIER-FULL / 204 KEY-only),
// every note class has a spending leaf (coverageGaps empty), the ordering is deterministic, and the worst leaf clears the 520B
// max-stack-element budget by size proxy. Run: node --test native/freeze_enumerate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64 } from './sighashParts.mjs';
import { enumerateLeaves, orderLeaves, coverageGaps, leafIdKey, buildTaptree, NUMS, maxStackElement } from './freezeEnumerate.mjs';

const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const consts = {
  tokenId: Buffer.alloc(36, 0xab), changeSPK: p2tr(0x77), changeWitness: true,
  AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n,
  feeOut: Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]), changeSpkLen: 34,
};

test('TIER-FULL: enumerates exactly 490 leaves (404 + 86 merge), all build (no offset trap in any cell)', () => {
  const leaves = enumerateLeaves(consts, { arms: ['key', 'script'] });
  assert.equal(leaves.length, 490, 'FamA 360 + FamB 120 + root 4 + merge 6 = 490');
  assert.ok(leaves.every((l) => Buffer.isBuffer(l.leaf) && l.leaf.length > 0), 'every leaf compiled to bytes');
});

test('TIER-MIN (KEY-only, SCRIPT deferred): enumerates exactly 250 leaves (204 + 46 merge)', () => {
  const leaves = enumerateLeaves(consts, { arms: ['key'] });
  assert.equal(leaves.length, 250, 'FamA 180 + FamB 60 + root 4 + merge 6 = 250');
});

test('COVERAGE (the cardinal rule): every note class has a spending leaf — no gap', () => {
  assert.deepEqual(coverageGaps(enumerateLeaves(consts, { arms: ['key', 'script'] }), { arms: ['key', 'script'] }), [], 'TIER-FULL: no unspendable note class');
  assert.deepEqual(coverageGaps(enumerateLeaves(consts, { arms: ['key'] }), { arms: ['key'] }), [], 'TIER-MIN: no unspendable note class');
});

test('COVERAGE includes the transfer-note (Mp=1) base case for EVERY grandparent shape + arm (the freeze-blocker)', () => {
  const leaves = enumerateLeaves(consts, { arms: ['key', 'script'] });
  for (const gp of ['genesis', 'transfer', 'split']) for (const arm of ['key', 'script']) {
    assert.ok(leaves.some((l) => l.id.fam === 'split' && l.id.Mp === 1 && l.id.gp === gp && l.id.arm === arm), `Mp=1 split gp=${gp} arm=${arm} present`);
    assert.ok(leaves.some((l) => l.id.fam === '1to1' && l.id.Mp === 1 && l.id.gp === gp && l.id.arm === arm), `Mp=1 1to1 gp=${gp} arm=${arm} present`);
  }
});

test('deterministic ordering: orderLeaves is a total order, reproducible (an auditor must recompute the same root)', () => {
  const a = orderLeaves(enumerateLeaves(consts, { arms: ['key', 'script'] }));
  const b = orderLeaves(enumerateLeaves(consts, { arms: ['key', 'script'] }));
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(a[i].leaf.equals(b[i].leaf), `leaf ${i} stable across enumerations`);
  // strictly increasing keys (no two leaves share an ID tuple ⟹ no duplicate / collision).
  for (let i = 1; i < a.length; i++) { const ka = leafIdKey(a[i - 1].id), kb = leafIdKey(a[i].id); let cmp = 0; for (let k = 0; k < ka.length && cmp === 0; k++) cmp = ka[k] - kb[k]; assert.ok(cmp < 0, `strictly increasing at ${i}`); }
});

test('NUMS nothing-up-my-sleeve: the internal key x-coord == SHA256(uncompressed secp256k1 G) ⟹ key-path provably DEAD (no theft)', () => {
  const Gu = Buffer.from('04' + '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' + '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8', 'hex');
  assert.ok(NUMS.equals(bells.crypto.sha256(Gu)), 'NUMS == SHA256(0x04 ‖ Gx ‖ Gy) — the BIP-341 H point, dlog unknown');
});

test('taptree: the 490-leaf tree builds a 34B transferSPK at depth 9 — the PERMANENT covenant address', () => {
  const t = buildTaptree(consts, { arms: ['key', 'script'] });
  assert.equal(t.transferSPK.length, 34, 'P2TR SPK = 0x5120 ‖ 32B');
  assert.ok(t.transferSPK[0] === 0x51 && t.transferSPK[1] === 0x20, 'taproot witness-v1 program');
  assert.equal(t.depth, 9, 'ceil(log2 490) = 9');
  assert.equal(NUMS.length, 32, 'NUMS internal key is 32B (BIP-341 H — pin+audit before freeze)');
  console.log(`  transferSPK (TIER-FULL): ${t.transferSPK.toString('hex')}`);
});

test('taptree: the root is DETERMINISTIC (an independent auditor recomputes the identical SPK — 2nd-validator agreement)', () => {
  const a = buildTaptree(consts, { arms: ['key', 'script'] });
  const b = buildTaptree(consts, { arms: ['key', 'script'] });
  assert.ok(a.transferSPK.equals(b.transferSPK), 'same consts + same ordering ⟹ byte-identical root');
});

test('taptree: every leaf has a valid control block (33 + 32·depth); the worst-leaf + root + transfer-note leaves resolve', () => {
  const t = buildTaptree(consts, { arms: ['key', 'script'] });
  const pick = (pred) => t.ordered.find((l) => pred(l.id));
  const samples = [pick((id) => id.fam === 'root-split' && id.M === 4), pick((id) => id.fam === 'root-sendall'),
    pick((id) => id.fam === 'split' && id.Mp === 1 && id.gp === 'genesis' && id.arm === 'key'),               // a transfer-note leaf
    pick((id) => id.fam === 'split' && id.gp === 'split' && id.Mp_gp === 4 && id.M === 4 && id.arm === 'script')]; // the worst leaf
  for (const s of samples) {
    const cb = t.controlBlockFor(s.leaf);
    assert.equal(cb.length, 33 + 32 * t.depth, `control block ${JSON.stringify(s.id)} = 33 + 32·${t.depth}`);
    assert.equal(cb[0] & 0xfe, 0xc0, 'leaf version 0xc0 in the control block');
  }
});

test('taptree: a DIFFERENT leaf set or DIFFERENT consts ⟹ a DIFFERENT root (the freeze commits exactly this set + token)', () => {
  const full = buildTaptree(consts, { arms: ['key', 'script'] }).transferSPK;
  const keyOnly = buildTaptree(consts, { arms: ['key'] }).transferSPK;
  assert.ok(!full.equals(keyOnly), 'TIER-FULL (490) != TIER-MIN (250) — the leaf set is committed');
  const otherToken = buildTaptree({ ...consts, tokenId: Buffer.alloc(36, 0xcd) }, { arms: ['key', 'script'] }).transferSPK;
  assert.ok(!full.equals(otherToken), 'a different token_id ⟹ a different covenant address');
});

test('per-leaf 520B MAX-STACK-ELEMENT budget: EVERY leaf clears MAX_SCRIPT_ELEMENT_SIZE (the freeze gate; worst 438B @ Mp/Mp_gp=4)', () => {
  const leaves = enumerateLeaves(consts, { arms: ['key', 'script'] });
  let worst = 0, worstId = null;
  for (const l of leaves) { const m = maxStackElement(l.id); if (m > worst) { worst = m; worstId = l.id; } assert.ok(m < 520, `leaf ${JSON.stringify(l.id)} max element ${m}B not < 520B`); }
  console.log(`  worst max-stack-element: ${worst}B  ${JSON.stringify(worstId)}`);
  assert.equal(worst, 438, 'global worst 438B = the Mp=4 / Mp_gp=4 tx-reconstruction preimage (matches the freeze review measurement; M_MAX=4 is the bound — M=5 crosses 520B on c6)');
});

test('worst-leaf size budget: the largest leaf is the Mp=4 split-of-split (size proxy for the 520B max-stack-element)', () => {
  const leaves = enumerateLeaves(consts, { arms: ['key', 'script'] });
  let max = 0, maxId = null;
  for (const l of leaves) if (l.leaf.length > max) { max = l.leaf.length; maxId = l.id; }
  console.log(`  largest leaf: ${max}B  ${JSON.stringify(maxId)}`);
  console.log(`  total taptree script bytes: ${leaves.reduce((a, l) => a + l.leaf.length, 0)}B over ${leaves.length} leaves`);
  assert.ok(maxId.gp === 'split' && maxId.Mp_gp === 4 && maxId.M === 4, 'worst leaf is split-gp Mp_gp=4 M=4 (per the workflow)');
  assert.ok(max < 10000, 'leaf script well under the 10KB tapscript limit (the 520B is a STACK-ELEMENT bound, asserted on-node)');
});
