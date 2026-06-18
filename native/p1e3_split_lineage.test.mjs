// P2-5 LINEAGE v2 kernel — the position-aware split-parent reconstruction PROVES amount_in/owner_in from the spent note's
// stateOut at its REAL vout 2j (closing the mini split leaf's free-witness "parent-forgeable" hole). scriptsim (pure hash/CAT,
// no CSFS): rebuild a REAL split parent, hash256==committedTxidP, extract (amount_in, owner_in) for child j; REDs reject.
// Run: node --test native/p1e3_split_lineage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { splitParentReconstructOps, splitParentWitness } from './p1e3SplitLineage.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId, amount, owner }))]);

// a REAL split parent (degree M') + its legacy bytes; the spent note is its child j (tokenOut_j @ 2j).
function realParent(children, changeVal) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff); // the GRANDPARENT pointer (txP.vin0)
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, changeVal);
  const legacy = tx.toBuffer();
  const vin0Outpoint = legacy.subarray(5, 41); // HDR_S(5) then the 36B outpoint
  return { legacy, committedTxidP: hash256(legacy), vin0Outpoint };
}

const children = [
  { value: 80000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0) },
  { value: 60000, amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0) },
];
const changeVal = 9000;

function run(M, j, witness) {
  const r = runScript(splitParentReconstructOps(M, j, { tokenId, ownSPK, changeSPK }).ops, witness);
  return { amount_in: r.main[r.main.length - 1], owner_in: r.main[r.main.length - 2] };
}
const rejects = (M, j, w) => { try { run(M, j, w); return false; } catch { return true; } };

test('lineage-v2 kernel: reconstruct a real 2-way split parent, hash256==committedTxidP, EXTRACT (amount_in, owner_in) for child j', () => {
  const p = realParent(children, changeVal);
  const wit = splitParentWitness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) });
  for (const j of [0, 1]) {
    const { amount_in, owner_in } = run(2, j, wit);
    assert.ok(amount_in.equals(encodeAmount(children[j].amount)), `child ${j} amount_in backtrace-proven`);
    assert.ok(owner_in.equals(children[j].owner), `child ${j} owner_in backtrace-proven`);
  }
});

test('lineage-v2 kernel REDs: a forged parent (wrong amount/owner/vin0_outpoint) fails hash256 == committedTxidP', () => {
  const p = realParent(children, changeVal);
  const mk = (mut) => { const o = children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })); mut(o); return splitParentWitness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal, outputs: o }); };
  // forge child0's amount (claim 7M+1) -> reconstructed stateOut_0 != real -> hash mismatch
  assert.ok(rejects(2, 0, mk((o) => { o[0].amountSer = encodeAmount(7_000_001n); })), 'forged amount rejects');
  // forge child1's owner
  assert.ok(rejects(2, 1, mk((o) => { o[1].owner = Buffer.alloc(20, 0xee); })), 'forged owner rejects');
  // forge vin0_outpoint (the grandparent pointer) -> hash mismatch
  const badVin = splitParentWitness({ committedTxidP: p.committedTxidP, vin0Outpoint: Buffer.alloc(36, 0xcc), changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) });
  assert.ok(rejects(2, 0, badVin), 'forged grandparent pointer rejects');
  // wrong committedTxidP (claim a different parent) -> mismatch
  const badTxid = splitParentWitness({ committedTxidP: Buffer.alloc(32, 0x11), vin0Outpoint: p.vin0Outpoint, changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) });
  assert.ok(rejects(2, 0, badTxid), 'wrong parent txid rejects');
});

test('lineage-v2 kernel: child0-state-for-child1 is impossible — j is a leaf CONSTANT, so the parked stateOut is exactly child j', () => {
  // use DISTINCT amounts (already 7M vs 14M): spending child1 (j=1) extracts child1's 14M, never child0's 7M.
  const p = realParent(children, changeVal);
  const wit = splitParentWitness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) });
  const { amount_in } = run(2, 1, wit);
  assert.ok(amount_in.equals(encodeAmount(14_000_000n)), 'j=1 extracts child1 (14M), not child0 (7M)');
  assert.ok(!amount_in.equals(encodeAmount(7_000_000n)));
});

test('lineage-v2 kernel: M′=3 and M′=4 parents reconstruct + extract correctly (voutCount 0x07/0x09)', () => {
  for (const M of [3, 4]) {
    const kids = Array.from({ length: M }, (_, k) => ({ value: 10000 + k, amount: BigInt(1_000_000 * (k + 1)), owner: Buffer.alloc(20, 0x30 + k) }));
    const p = realParent(kids, 5000);
    const wit = splitParentWitness({ committedTxidP: p.committedTxidP, vin0Outpoint: p.vin0Outpoint, changeVal: 5000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) });
    for (let j = 0; j < M; j++) {
      const { amount_in, owner_in } = run(M, j, wit);
      assert.ok(amount_in.equals(encodeAmount(kids[j].amount)) && owner_in.equals(kids[j].owner), `M'=${M} j=${j}`);
    }
  }
});
