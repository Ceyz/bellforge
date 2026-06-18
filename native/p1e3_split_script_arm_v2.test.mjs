// P2-0 BRICK 8 — the SCRIPT-owned arm (the trustless-pool enabler). Spends an owner_type=SCRIPT note WITHOUT the owner key, by
// CO-SPENDING a controller input @ vin1: the 2-input c2 = SHA256(outpoint0 ‖ outpoint1) (note-first, position-aware) + c4 =
// SHA256(varslice(ownSPK) ‖ varslice(controllerSPK)) force vinCount==2 ∧ input[1].spk==controllerSPK; owner_in == hash160(
// controllerSPK ‖ pool_id ‖ state_id) BINDs the controller instance; NO owner-key check (the controller authorizes). scriptsim
// with a real 2-INPUT sighash. Run: node --test native/p1e3_split_script_arm_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Ops, splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';

const S = bells.crypto.sha256, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK, arm: 'script' };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const sig = Buffer.alloc(64, 0x0c), P = Buffer.alloc(32, 0x0b);

// the pool/controller this SCRIPT note is committed to.
const controllerSPK = p2tr(0x33), poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);  // = the note's owner_in
const ctrlTxidInternal = Buffer.alloc(32, 0x99), ctrlVout = 0;
const ctrlOutpoint = Buffer.concat([ctrlTxidInternal, u32le(ctrlVout)]);

// txP: a v2 split whose child j is the SCRIPT note (owner = SCRIPT_OWNER, owner_type=SCRIPT) — unless overridden for the wrong-type RED.
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

// spend the SCRIPT note (vin0) + a controller input (vin1) into M children. `script` overrides the controller witness for REDs.
function trySpend({ Mp, j, txp, outs, oneInput, script }) {
  const amountIn = outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a);
  const noteTxidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const ctrlTxidHex = Buffer.from(ctrlTxidInternal).reverse().toString('hex');
  const changeValue = 15000;
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const inputs = [{ txid: noteTxidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }];
  if (!oneInput) inputs.push({ txid: ctrlTxidHex, vout: ctrlVout, value: 50000, spk: controllerSPK, sequence: 0xffffffff }); // controller @ vin1
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2ScriptWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs, amountIn, N, script: script ?? { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
  return runScript(splitFullLineageV2Ops(Mp, j, 2, N, consts).ops, w, sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

// RED-6 (controller-design workflow): ROLE-SWAP [controller@vin0, note@vin1]. The controller-design lens worried that c1/c7 being FREE
// witnesses lets a re-ordered 2-input tx pass (the L4 hardening: bake inIndex==0). EMPIRICAL CHECK — is the role-swap ALREADY defeated
// by the note-first c2? The leaf builds c2 = SHA256(note_outpoint ‖ outpoint1), but a [controller@vin0, note@vin1] tx has real
// shaPrevouts = SHA256(controller_outpoint ‖ note_outpoint) ⟹ c2 != real ⟹ CSFS rejects, REGARDLESS of the free c1/c7.
function trySpendRoleSwap({ Mp, j, txp, outs }) {
  const amountIn = outs.reduce((a, o) => a + o.amount, 0n), leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const noteTxidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const ctrlTxidHex = Buffer.from(ctrlTxidInternal).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const inputs = [{ txid: ctrlTxidHex, vout: ctrlVout, value: 50000, spk: controllerSPK, sequence: 0xffffffff },     // controller @ vin0
                  { txid: noteTxidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }];      // note @ vin1
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 1, leafHash, parts });               // the note runs at inIndex=1
  const w = splitFullLineageV2ScriptWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs, amountIn, N, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
  return runScript(splitFullLineageV2Ops(Mp, j, 2, N, consts).ops, w, sighash);
}
test('RED-6 role-swap [controller@vin0, note@vin1]: rejected by the note-first c2 (L4 is ALREADY covered — no leaf-byte change needed)', () => {
  const txp = buildTxP(2, 1, 14_000_000n);
  let ok; try { ok = trySpendRoleSwap({ Mp: 2, j: 1, txp, outs: curOuts }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'role-swap rejected: c2=SHA256(note‖ctrl) != real shaPrevouts SHA256(ctrl‖note)');
});

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }];

test('SCRIPT arm GREEN: a controller co-spend authorizes a SCRIPT note split (no owner key); 2-input c2/c4 byte-exact', () => {
  for (const j of [0, 1]) {
    const txp = buildTxP(2, j, 14_000_000n);
    assert.ok(trySpend({ Mp: 2, j, txp, outs: curOuts }).ok, `SCRIPT split j=${j}`);
  }
});

test('SCRIPT arm RED owner_type_in!=SCRIPT: a KEY note via the SCRIPT arm rejects (arm selected by committed type)', () => {
  const txp = buildTxP(2, 1, 14_000_000n, OwnerType.KEY, Buffer.alloc(20, 0xee));
  assert.ok(rejects({ Mp: 2, j: 1, txp, outs: curOuts }), 'KEY note via SCRIPT arm rejects');
});

test('SCRIPT arm RED wrong controllerSPK: a co-spend at the WRONG SPK rejects (c4 mismatch + descriptor mismatch)', () => {
  const txp = buildTxP(2, 1, 14_000_000n);
  // witness claims a different controllerSPK than the one the tx actually co-spends @ vin1 (and than owner_in commits).
  assert.ok(rejects({ Mp: 2, j: 1, txp, outs: curOuts, script: { outpoint1: ctrlOutpoint, controllerSPK: p2tr(0xde), poolId, stateId } }), 'wrong controllerSPK rejects');
});

test('SCRIPT arm RED cross-instance: a different pool_id/state_id rejects (owner descriptor BIND)', () => {
  const txp = buildTxP(2, 1, 14_000_000n);
  assert.ok(rejects({ Mp: 2, j: 1, txp, outs: curOuts, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId: Buffer.alloc(32, 0xaa), stateId } }), 'wrong pool_id rejects');
  assert.ok(rejects({ Mp: 2, j: 1, txp, outs: curOuts, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId: Buffer.alloc(32, 0xbb) } }), 'wrong state_id rejects');
});

test('SCRIPT arm RED 1-input (no controller co-spend): the 2-input c2/c4 cannot match a 1-input sighash', () => {
  const txp = buildTxP(2, 1, 14_000_000n);
  assert.ok(rejects({ Mp: 2, j: 1, txp, outs: curOuts, oneInput: true }), 'a 1-input spend (no controller) rejects');
});

test('SCRIPT arm leaf size reported', () => {
  const leaf = bells.script.compile(splitFullLineageV2Ops(2, 0, 2, N, consts).ops);
  console.log(`  SCRIPT-arm split leaf M'=2 j=0 M=2: ${leaf.length}B`);
  assert.ok(leaf.length > 0);
});
