// P2-0 BRICK 0 — the STATE v2 lineage kernel: reconstruct a v2 (owner_type) split parent + extract (amount_in, owner_in,
// owner_type_in) from the spent note's 66B stateOut_j. scriptsim (pure hash/CAT). Proves the +1-byte owner_type shift is byte-exact
// and a per-note owner_type (a key-owned child next to a script-owned sibling) reconstructs + extracts correctly; REDs reject.
// Run: node --test native/p1e3_split_lineage_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { splitParentReconstructV2Ops, splitParentV2Witness } from './p1e3SplitLineageV2.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner, ownerType) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType, tokenId, amount, owner }))]);

// a REAL v2 split parent (degree M'); the spent note is child j (tokenOut_j @ 2j). children carry per-note owner_type.
function realParentV2(children, changeVal) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeVal);
  const legacy = tx.toBuffer();
  return { legacy, committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41) };
}

// child0 = KEY-owned, child1 = SCRIPT-owned (a sibling deposited into a pool) — proves the per-note owner_type.
const children = [
  { value: 80000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), ownerType: OwnerType.KEY },
  { value: 60000, amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), ownerType: OwnerType.SCRIPT },
];
const changeVal = 9000;
const outputsOf = (kids) => kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType }));

function run(M, j, witness) {
  const r = runScript(splitParentReconstructV2Ops(M, j, { tokenId, ownSPK, changeSPK }).ops, witness);
  return { amount_in: r.main[r.main.length - 1], owner_in: r.main[r.main.length - 2], owner_type_in: r.main[r.main.length - 3] };
}
const rejects = (M, j, w) => { try { run(M, j, w); return false; } catch { return true; } };

test('v2 kernel: reconstruct a v2 split parent + EXTRACT (amount_in, owner_in, owner_type_in); KEY child0 + SCRIPT child1', () => {
  const p = realParentV2(children, changeVal);
  const wit = splitParentV2Witness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal, outputs: outputsOf(children) });
  for (const j of [0, 1]) {
    const { amount_in, owner_in, owner_type_in } = run(2, j, wit);
    assert.ok(amount_in.equals(encodeAmount(children[j].amount)), `child ${j} amount_in`);
    assert.ok(owner_in.equals(children[j].owner), `child ${j} owner_in`);
    assert.ok(owner_type_in.length === 1 && owner_type_in[0] === children[j].ownerType, `child ${j} owner_type_in = ${children[j].ownerType}`);
  }
});

test('v2 kernel REDs: a forged owner_type / amount / owner breaks hash256 == committedTxidP', () => {
  const p = realParentV2(children, changeVal);
  const mk = (mut) => { const o = outputsOf(children); mut(o); return splitParentV2Witness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal, outputs: o }); };
  // forge child1's owner_type (claim KEY while the real stateOut commits SCRIPT) -> reconstructed stateOut_1 != real -> hash mismatch
  assert.ok(rejects(2, 1, mk((o) => { o[1].ownerType = OwnerType.KEY; })), 'forged owner_type rejects');
  assert.ok(rejects(2, 0, mk((o) => { o[0].amountSer = encodeAmount(7_000_001n); })), 'forged amount rejects');
  assert.ok(rejects(2, 1, mk((o) => { o[1].owner = Buffer.alloc(20, 0xee); })), 'forged owner rejects');
});

test('v2 kernel: M′=3/4 parents with mixed owner_types reconstruct + extract', () => {
  for (const M of [3, 4]) {
    const kids = Array.from({ length: M }, (_, k) => ({ value: 10000 + k, amount: BigInt(1_000_000 * (k + 1)), owner: Buffer.alloc(20, 0x30 + k), ownerType: k % 3 }));
    const p = realParentV2(kids, 5000);
    const wit = splitParentV2Witness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal: 5000, outputs: outputsOf(kids) });
    for (let j = 0; j < M; j++) {
      const { amount_in, owner_in, owner_type_in } = run(M, j, wit);
      assert.ok(amount_in.equals(encodeAmount(kids[j].amount)) && owner_in.equals(kids[j].owner) && owner_type_in[0] === kids[j].ownerType, `M'=${M} j=${j}`);
    }
  }
});
