// P2-0 BRICK 8 — the SCRIPT-owned arm on the 1→1 SEND-ALL leaf (the WITHDRAW path). A controller co-spend @ vin1 authorizes a
// SCRIPT note's full-amount re-emission, retargeting the output owner_type FREELY (script→key withdrawal, script→script rebalance,
// script→burn redeem). Same 2-input c2 = SHA256(outpoint0 ‖ outpoint1) + c4 = SHA256(varslice(ownSPK) ‖ varslice(controllerSPK)) +
// owner-descriptor BIND as the split SCRIPT arm, with NO owner key. scriptsim with a real 2-INPUT sighash.
// Run: node --test native/p1e3_transfer_script_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { transferSendAllV2Ops, transferSendAllV2ScriptWitness } from './p1e3TransferV2.mjs';
import { scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';

const S = bells.crypto.sha256, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK, arm: 'script' };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const sig = Buffer.alloc(64, 0x0c), P = Buffer.alloc(32, 0x0b);

const controllerSPK = p2tr(0x33), poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
const ctrlTxidInternal = Buffer.alloc(32, 0x99), ctrlVout = 0;
const ctrlOutpoint = Buffer.concat([ctrlTxidInternal, u32le(ctrlVout)]);

// txP: a v2 split whose child j is the SCRIPT note (owner=SCRIPT_OWNER, owner_type=SCRIPT) — unless overridden for the wrong-type RED.
function buildTxP(Mp, j, amountIn, jType = OwnerType.SCRIPT, jOwner = SCRIPT_OWNER) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? jOwner : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? jType : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x42)), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

// withdraw the SCRIPT note (vin0) + a controller input (vin1) → ONE note carrying the FULL amount. `script` overrides for REDs.
function trySpend({ Mp, j, txp, out, amountIn, outAmount, oneInput, script }) {
  const committedAmount = outAmount !== undefined ? outAmount : amountIn;
  const leafHash = Buffer.alloc(32, 0x5a);
  const noteTxidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const ctrlTxidHex = Buffer.from(ctrlTxidInternal).reverse().toString('hex');
  const changeValue = 15000;
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(committedAmount, out.owner, out.ownerType) }, { value: changeValue, script: changeSPK }];
  const inputs = [{ txid: noteTxidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }];
  if (!oneInput) inputs.push({ txid: ctrlTxidHex, vout: ctrlVout, value: 50000, spk: controllerSPK, sequence: 0xffffffff }); // controller @ vin1
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = transferSendAllV2ScriptWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, out, amountIn: committedAmount, script: script ?? { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
  return runScript(transferSendAllV2Ops(Mp, j, N, consts).ops, w, sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

test('1→1 SCRIPT GREEN: controller co-spend WITHDRAWS a SCRIPT note → key (script→key, full amount, no owner key)', () => {
  for (const j of [0, 1]) {
    const txp = buildTxP(2, j, 21_000_000n);
    assert.ok(trySpend({ Mp: 2, j, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n }).ok, `script→key j=${j}`);
  }
});

test('1→1 SCRIPT GREEN: script→script rebalance AND script→burn redeem (owner_type_out is FREE)', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(trySpend({ Mp: 2, j: 1, txp, out: { owner: SCRIPT_OWNER, value: 250000, ownerType: OwnerType.SCRIPT }, amountIn: 21_000_000n }).ok, 'script→script');
  assert.ok(trySpend({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0x00), value: 250000, ownerType: OwnerType.BURN }, amountIn: 21_000_000n }).ok, 'script→burn');
});

test('1→1 SCRIPT RED inflation: amount_out != amount_in rejects (conservation byte-equality holds on the SCRIPT arm)', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(rejects({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n, outAmount: 21_000_001n }), 'inflated withdraw rejects');
});

test('1→1 SCRIPT RED owner_type_in!=SCRIPT: a KEY note via the SCRIPT 1→1 leaf rejects', () => {
  const txp = buildTxP(2, 1, 21_000_000n, OwnerType.KEY, Buffer.alloc(20, 0xee));
  assert.ok(rejects({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n }), 'KEY note via SCRIPT 1→1 rejects');
});

test('1→1 SCRIPT RED wrong controllerSPK / cross-instance: c4 + descriptor BIND reject', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  const out = { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY };
  assert.ok(rejects({ Mp: 2, j: 1, txp, out, amountIn: 21_000_000n, script: { outpoint1: ctrlOutpoint, controllerSPK: p2tr(0xde), poolId, stateId } }), 'wrong controllerSPK rejects');
  assert.ok(rejects({ Mp: 2, j: 1, txp, out, amountIn: 21_000_000n, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId: Buffer.alloc(32, 0xaa), stateId } }), 'wrong pool_id rejects');
  assert.ok(rejects({ Mp: 2, j: 1, txp, out, amountIn: 21_000_000n, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId: Buffer.alloc(32, 0xbb) } }), 'wrong state_id rejects');
});

test('1→1 SCRIPT RED 1-input (no controller co-spend): the 2-input c2/c4 cannot match a 1-input sighash', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(rejects({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n, oneInput: true }), 'a 1-input withdraw (no controller) rejects');
});

test('1→1 SCRIPT leaf size reported', () => {
  const leaf = bells.script.compile(transferSendAllV2Ops(2, 0, N, consts).ops);
  console.log(`  1→1 send-all v2 leaf (SCRIPT) M'=2 j=0: ${leaf.length}B`);
  assert.ok(leaf.length > 0);
});
