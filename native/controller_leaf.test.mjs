// P2-0 BRICK 11 brick-2 — the toy no-escape controller LEAF (scriptsim). GREEN: a REAL controller (its genesis note, lineage-proven)
// binds the 2-input vin1 sighash. RED-1 (the keystone): a DUMMY UTXO at controllerSPK (committedTxidP != the baked genesis) fails the
// genesis reconstruction ⟹ unspendable ⟹ cannot authorize a SCRIPT-note theft. RED: a wrong inIndex (the controller is baked to vin1).
// Run: node --test native/controller_leaf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { runScript } from './scriptsim.mjs';
import { controllerLeafOps, controllerGenesisTx } from './controllerCovenant.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const controllerSPK = p2tr(0x33), noteSPK = p2tr(0x11), changeSPK = p2tr(0x55), CG = Buffer.alloc(36, 0xc6);
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const minterOutpoint = Buffer.alloc(36, 0x42), VALUE_0 = 1_000_000n, changeVal = 5000;
const sig = Buffer.alloc(64, 0x0c), P = Buffer.alloc(32, 0x0b), leafHash = Buffer.alloc(32, 0x5a);
const consts = { CG, minterOutpoint, VALUE_0, feeOut };

// the real controller genesis → the controller note @ genesisTxid vout0.
const g = controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint, changeVal, changeSPK });

// build the 2-input co-spend [SCRIPT note @vin0, controller @vin1] + run the controller leaf at inIndex=1. `committedTxid` overrides
// the witness committedTxidP (for the dummy RED); `inIndex` overrides the leaf-vs-tx inIndex (for the position RED).
function tryController({ committedTxid = g.genesisTxid, inIndex = 1, vin0OutpointWit = null } = {}) {
  const noteTxidInternal = Buffer.alloc(32, 0xa0), noteVout = 0;
  const realVin0Outpoint = Buffer.concat([noteTxidInternal, u32le(noteVout)]);
  const noteOutpoint = vin0OutpointWit ?? realVin0Outpoint;  // the witness-declared vin0 (forge-bait until c2 binds it to the REAL prevout)
  const outputs = [{ value: 40000, script: noteSPK }, { value: 9000, script: changeSPK }]; // arbitrary — the controller doesn't constrain them
  const inputs = [{ txid: Buffer.from(noteTxidInternal).reverse().toString('hex'), vout: noteVout, value: 50000, spk: noteSPK, sequence: 0xffffffff },
                  { txid: Buffer.from(g.genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: controllerSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, post: c9, sighash } = reassembleSighash({ inIndex, leafHash, parts });
  const w = [committedTxid, noteOutpoint, noteSPK, controllerSPK, u64(changeVal), changeSPK, sig, P, c1, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, leafHash, c9];
  return runScript(controllerLeafOps(consts).ops, w, sighash);
}

test('GREEN: a REAL controller (its genesis note) binds the 2-input vin1 sighash — the lineage proof + the co-spend authorization', () => {
  assert.ok(tryController().ok, 'real controller authorizes (genesis reconstruction matches + c2/c4 = the real 2-input shaPrevouts/SPKs)');
});

test('RED-1 dummy-UTXO (the keystone B-SCRIPT closure): a UTXO at controllerSPK with no genesis lineage is UNSPENDABLE', () => {
  // a dummy's committedTxidP is the hash of its OWN (non-genesis) parent — != hash256(the baked controller genesis).
  let ok; try { ok = tryController({ committedTxid: Buffer.alloc(32, 0xee) }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'the dummy fails the genesis reconstruction EQUALVERIFY ⟹ cannot authorize a theft');
});

test('RED inIndex: the controller is BAKED to vin1 (c7=0x02‖u32le(1)); running it at inIndex=0 rejects (ACP/position pin)', () => {
  let ok; try { ok = tryController({ inIndex: 0 }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'a vin0/inIndex=0 controller spend rejects (the baked c7 forces inIndex==1)');
});

test('RED-2 cross-instance: a sibling controller (a DIFFERENT minter outpoint ⟹ different genesis) cannot be spent under THIS leaf', () => {
  // the leaf bakes minterOutpoint; a note from a genesis with a different minterOutpoint has committedTxidP = the OTHER genesis txid.
  const sibling = controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint: Buffer.alloc(36, 0x77), changeVal, changeSPK });
  let ok; try { ok = tryController({ committedTxid: sibling.genesisTxid }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'this leaf reconstructs THIS minterOutpoint ⟹ hash256 != the sibling genesis txid (pool isolation)');
});

test('RED-3 c2 forge-bait: lying about the co-spent vin0 outpoint breaks c2=SHA256(vin0‖controller) vs the real shaPrevouts', () => {
  // vin0Outpoint is a free witness field; the leaf folds it into c2. A wrong value ⟹ computed c2 != real shaPrevouts ⟹ CSFS reject.
  let ok; try { ok = tryController({ vin0OutpointWit: Buffer.alloc(36, 0xfe) }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'a forged vin0 outpoint cannot satisfy the real 2-input shaPrevouts binding');
});

test('controller leaf size reported', () => {
  console.log(`  controller leaf (toy, genesis-only, 2-input vin1): ${bells.script.compile(controllerLeafOps(consts).ops).length}B`);
  assert.ok(true);
});
