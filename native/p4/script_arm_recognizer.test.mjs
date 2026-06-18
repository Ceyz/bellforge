// P4 SCRIPT-arm recognizer — proves the genesis-mirror extends to the controller-authorized SCRIPT arm: a 2-INPUT SCRIPT-note
// split is attributed (M children BIND-credited, owner_types carried); the consensus-bound vinCount↔owner_type invariant HALTs a
// structurally-impossible spend (a SCRIPT note in a 1-input tx, a terminal BURN note spent); a forged candidate fails the v2 BIND
// fail-closed. Run: node --test native/p4/script_arm_recognizer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, encodeAmount, OwnerType } from '../wire.mjs';
import { splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from '../p1e3SplitFullLineageV2.mjs';
import { recognizeScriptSplit, isScriptSplitShape, expectedInputCount } from './scriptArmPredicates.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

const controllerSPK = p2tr(0x33), poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
const ctrlOutpoint = Buffer.concat([Buffer.alloc(32, 0x99), u32le(0)]);

// build a 2-input SCRIPT-arm split (note@vin0 + controller@vin1) + vin0's state-v2 SCRIPT witness. `oneInput` drops vin1 (RED).
function buildScriptSplit({ Mp, j, children, changeValue, oneInput, scriptFields }) {
  const amountIn = children.reduce((a, c) => a + c.amount, 0n);
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 2 * j, 0xffffffff);                 // vin0 = the SCRIPT note
  if (!oneInput) tx.addInput(Buffer.alloc(32, 0x99), 0, 0xffffffff);      // vin1 = the controller co-spend (outpoint = 0x99…‖0 == ctrlOutpoint)
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: Mp }, (_, k) => ({ value: 100000 + k, amountSer: encodeAmount(BigInt(3_000_000 * (k + 1))), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
  const w = splitFullLineageV2ScriptWitness({ parent, epi, ownSPK, changeValue, outs: children, amountIn, N, script: scriptFields || { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
  tx.ins[0].witness = [...w, Buffer.alloc(40), Buffer.alloc(33)];          // ‖ leaf, controlBlock (indexer ignores; bottom-relative reads)
  if (!oneInput) tx.ins[1].witness = [Buffer.from([0x01]), Buffer.alloc(33)]; // a toy controller witness
  return { tx, amountIn };
}

const children = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: SCRIPT_OWNER, value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }];
const spentNote = (extra = {}) => ({ tokenId: G, amount: 14_000_000n, ownerType: OwnerType.SCRIPT, owner: SCRIPT_OWNER, ...extra });

test('input-count is consensus-bound to owner_type: KEY⟹1, SCRIPT⟹2, BURN⟹null (terminal)', () => {
  assert.equal(expectedInputCount(OwnerType.KEY), 1);
  assert.equal(expectedInputCount(OwnerType.SCRIPT), 2);
  assert.equal(expectedInputCount(OwnerType.BURN), null);
});

test('GREEN: a 2-input SCRIPT split is attributed — M children BIND-credited, owner_types carried (script→key/script)', () => {
  const Mp = 2;
  const { tx } = buildScriptSplit({ Mp, j: 1, children, changeValue: 15000 });
  assert.ok(isScriptSplitShape(tx, ownSPK), 'recognized as a 2-input SCRIPT split');
  const r = recognizeScriptSplit(tx, ownSPK, spentNote(), Mp, N);
  assert.ok(r && r.children && r.children.length === 2, 'credits M children');
  assert.equal(r.children[0].amount, 5_000_000n); assert.equal(r.children[0].ownerType, OwnerType.KEY);
  assert.equal(r.children[1].amount, 9_000_000n); assert.equal(r.children[1].ownerType, OwnerType.SCRIPT);
  assert.ok(r.children.every((c) => [0, 2].includes(c.vout)), 'children at vouts 0,2');
});

test('BIND-not-DECLARE owner_in: a witness controllerSPK ≠ the committed descriptor HALTs (2nd validator, not just trusting consensus)', () => {
  const { tx } = buildScriptSplit({ Mp: 2, j: 1, children, changeValue: 15000, scriptFields: { outpoint1: ctrlOutpoint, controllerSPK: p2tr(0x44), poolId, stateId } });
  const r = recognizeScriptSplit(tx, ownSPK, spentNote(), 2, N);
  assert.ok(r && r.halt, 'a wrong witness controllerSPK ⟹ re-derived owner_in != stored owner ⟹ HALT');
  assert.match(r.reason, /owner_in .* != stored note owner/);
});

test('BIND-not-DECLARE outpoint1: a witness outpoint1 ≠ the real vin1 outpoint HALTs', () => {
  const wrongOp = Buffer.concat([Buffer.alloc(32, 0xaa), u32le(0)]);
  const { tx } = buildScriptSplit({ Mp: 2, j: 1, children, changeValue: 15000, scriptFields: { outpoint1: wrongOp, controllerSPK, poolId, stateId } });
  const r = recognizeScriptSplit(tx, ownSPK, spentNote(), 2, N);
  assert.ok(r && r.halt, 'a witness outpoint1 != the real vin1 outpoint ⟹ HALT');
  assert.match(r.reason, /outpoint1 != real vin1/);
});

test('HALT covenant_escape: a SCRIPT note appearing in a 1-input tx (structurally impossible — its leaf needs 2 inputs)', () => {
  const { tx } = buildScriptSplit({ Mp: 2, j: 1, children, changeValue: 15000, oneInput: true });
  const r = recognizeScriptSplit(tx, ownSPK, spentNote(), 2, N);
  assert.ok(r && r.halt, 'a 1-input spend of a SCRIPT note HALTs');
  assert.match(r.reason, /vinCount 1 contradicts owner_type-bound 2/);
});

test('HALT covenant_escape: a terminal BURN note appearing spent (no leaf authorizes spending a BURN note)', () => {
  const { tx } = buildScriptSplit({ Mp: 2, j: 1, children, changeValue: 15000 });
  const r = recognizeScriptSplit(tx, ownSPK, spentNote({ ownerType: OwnerType.BURN }), 2, N);
  assert.ok(r && r.halt, 'a BURN-note spend HALTs');
  assert.match(r.reason, /terminal\/unknown owner_type/);
});

test('null: a KEY note (vinCount 1) is NOT this recognizer — routed to the 1-input recognizers', () => {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 0, 0xffffffff);                    // 1 input
  tx.addOutput(ownSPK, 10000); tx.addOutput(stateScript(1n, Buffer.alloc(20, 0xaa), OwnerType.KEY), 0); tx.addOutput(changeSPK, 9000);
  const r = recognizeScriptSplit(tx, ownSPK, { tokenId: G, amount: 1n, ownerType: OwnerType.KEY, owner: Buffer.alloc(20, 0xaa) }, 2, N);
  assert.equal(r, null, 'a KEY note returns null (deferred to the KEY recognizers)');
});

test('BIND fail-closed: a forged spentNote.amount (Σ != amount) is not credited (null)', () => {
  const { tx } = buildScriptSplit({ Mp: 2, j: 1, children, changeValue: 15000 });
  const r = recognizeScriptSplit(tx, ownSPK, spentNote({ amount: 14_000_001n }), 2, N);
  assert.equal(r, null, 'a wrong Σ-conservation is not credited');
});

test('not-a-split: a 2-input tx whose outputs are not the split topology returns null', () => {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 2, 0xffffffff); tx.addInput(Buffer.alloc(32, 0x99), 0, 0xffffffff);
  tx.addOutput(ownSPK, 10000); tx.addOutput(changeSPK, 9000);            // not 2M+1 interleaved
  assert.equal(isScriptSplitShape(tx, ownSPK), false, 'not a split shape');
  assert.equal(recognizeScriptSplit(tx, ownSPK, spentNote(), 2, N), null, 'returns null (not this shape)');
});
