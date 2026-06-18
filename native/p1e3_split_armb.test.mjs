// P2-5 LINEAGE v2 ARM B (Steps 4 + 5) — the position-binding c2 + the conservation-target weld, on top of the proven kernel.
// scriptsim (pure hash/CAT, no CSFS): rebuild a REAL split parent, extract amount_in/owner_in, build c2 = SHA256(committedTxidP ‖
// u32le(2j)) and assert it == the REAL shaPrevouts of a "spend child j" tx; assert the conservation target serializes to amount_in
// (GREEN) and a forged target REJECTS (RED). A wrong-position leaf builds a c2 that does NOT match the real shaPrevouts (the CSFS
// epilogue would reject it). Run: node --test native/p1e3_split_armb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { sighashComponents } from './sighashParts.mjs';
import { splitArmBOps, splitArmBWitness } from './p1e3SplitArmB.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId, ownSPK, changeSPK };
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId, amount, owner }))]);

// a REAL split parent (degree M') + its legacy bytes; the spent note is child j = tokenOut_j @ vout 2j.
function realParent(children, changeVal) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);            // the grandparent pointer (txP.vin0)
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, changeVal);
  const legacy = tx.toBuffer();
  return { legacy, committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41) };
}

const children = [
  { value: 80000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0) },
  { value: 60000, amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0) },
];
const changeVal = 9000;
const outputsOf = (kids) => kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner }));

// the REAL shaPrevouts of a tx that spends txP's child j (outpoint = committedTxidP, vout 2j).
function realShaPrevouts(committedTxidP, j) {
  const txid = Buffer.from(committedTxidP).reverse().toString('hex');
  return sighashComponents({ inputs: [{ txid, vout: 2 * j, value: 546, spk: ownSPK, sequence: 0xffffffff }], outputs: [{ value: 546, script: ownSPK }] }).shaPrevouts;
}

function run(M, j, witness) {
  const r = runScript(splitArmBOps(M, j, consts).ops, witness);
  return { c2: r.main[r.main.length - 1], amount_in: r.main[r.main.length - 2], owner_in: r.main[r.main.length - 3] };
}
const rejects = (M, j, w) => { try { run(M, j, w); return false; } catch { return true; } };

test('arm B GREEN: c2 == real shaPrevouts, amount_in/owner_in backtrace-proven, conservation target == amount_in (M′=2, j∈{0,1})', () => {
  const p = realParent(children, changeVal);
  for (const j of [0, 1]) {
    const wit = splitArmBWitness({ ...p, changeVal, outputs: outputsOf(children), targetAmount: children[j].amount });
    const { c2, amount_in, owner_in } = run(2, j, wit);
    assert.ok(c2.equals(realShaPrevouts(p.committedTxidP, j)), `child ${j}: c2 == real shaPrevouts(vout ${2 * j})`);
    assert.ok(amount_in.equals(encodeAmount(children[j].amount)), `child ${j}: amount_in backtrace-proven`);
    assert.ok(owner_in.equals(children[j].owner), `child ${j}: owner_in backtrace-proven`);
  }
});

test('arm B STEP 5 RED: a forged conservation target (≠ backtrace-proven amount_in) rejects at the weld', () => {
  const p = realParent(children, changeVal);
  // claim a target of amount_in+1 while the parked amount_in is the real child amount -> weld EQUALVERIFY fails
  const over = splitArmBWitness({ ...p, changeVal, outputs: outputsOf(children), targetAmount: children[1].amount + 1n });
  assert.ok(rejects(2, 1, over), 'target = amount_in + 1 rejects');
  // the classic "sum=21M but amount_in=14M" inflation: spend child1 (14M) but declare a 21M target -> reject
  const inflate = splitArmBWitness({ ...p, changeVal, outputs: outputsOf(children), targetAmount: 21_000_000n });
  assert.ok(rejects(2, 1, inflate), 'inflated target 21M vs amount_in 14M rejects');
  // under-claim is symmetric
  const under = splitArmBWitness({ ...p, changeVal, outputs: outputsOf(children), targetAmount: 1n });
  assert.ok(rejects(2, 1, under), 'under-claimed target rejects');
});

test('arm B STEP 4 RED: a wrong-position leaf builds a c2 that does NOT match the spent note\'s real shaPrevouts', () => {
  const p = realParent(children, changeVal);
  // honest spend is of child 0 (vout 0). The j=0 leaf c2 must equal shaPrevouts(vout 0) and DIFFER from shaPrevouts(vout 2).
  const wit = splitArmBWitness({ ...p, changeVal, outputs: outputsOf(children), targetAmount: children[0].amount });
  const { c2 } = run(2, 0, wit);
  assert.ok(c2.equals(realShaPrevouts(p.committedTxidP, 0)), 'j=0 leaf binds vout 0');
  assert.ok(!c2.equals(realShaPrevouts(p.committedTxidP, 1)), 'j=0 leaf c2 != vout-2 shaPrevouts (position-bound ⟹ CSFS would reject a child-1 spend)');
});

test('arm B GREEN: M′=3 and M′=4 parents (voutCount 0x07/0x09), every child position binds + welds', () => {
  for (const M of [3, 4]) {
    const kids = Array.from({ length: M }, (_, k) => ({ value: 10000 + k, amount: BigInt(1_000_000 * (k + 1)), owner: Buffer.alloc(20, 0x30 + k) }));
    const p = realParent(kids, 5000);
    for (let j = 0; j < M; j++) {
      const wit = splitArmBWitness({ ...p, changeVal: 5000, outputs: outputsOf(kids), targetAmount: kids[j].amount });
      const { c2, amount_in, owner_in } = run(M, j, wit);
      assert.ok(c2.equals(realShaPrevouts(p.committedTxidP, j)), `M'=${M} j=${j}: c2 binds vout ${2 * j}`);
      assert.ok(amount_in.equals(encodeAmount(kids[j].amount)) && owner_in.equals(kids[j].owner), `M'=${M} j=${j}: backtrace`);
    }
  }
});
