// P2-0 BRICK 11 brick-1 — the controller STATE + GENESIS foundation. Asserts the state/stateOut widths, the pool_id derivation
// (= SHA256(minter outpoint) — known BEFORE the genesis tx, so controllerSPK=P2TR(NUMS,leaf(pool_id)) is non-circular), and the
// genesis tx byte-shape (mirrors the token genesis so the controller leaf's grandparent arm can reconstruct it). Run: node --test native/controller_genesis.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64 } from './sighashParts.mjs';
import { encodeControllerState, controllerStateOut, poolIdFromGenesisOutpoint, controllerGenesisTx, CONTROLLER_STATE_PREFIX } from './controllerCovenant.mjs';

const S = bells.crypto.sha256;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const controllerSPK = p2tr(0x33), changeSPK = p2tr(0x55), CG = Buffer.alloc(36, 0xc6);
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const minterOutpoint = Buffer.alloc(36, 0x42);

test('controller state: 65B preimage (0x03 ‖ pool_id(32) ‖ state_id(32)), 43B stateOut; widths pinned', () => {
  const poolId = Buffer.alloc(32, 0xaa), stateId = Buffer.alloc(32, 0xbb);
  const st = encodeControllerState({ poolId, stateId });
  assert.equal(st.length, 65); assert.equal(st[0], CONTROLLER_STATE_PREFIX[0]);
  assert.ok(st.subarray(1, 33).equals(poolId) && st.subarray(33, 65).equals(stateId), 'pool_id ‖ state_id in order');
  assert.equal(controllerStateOut({ poolId, stateId }).length, 43, 'FRAME(11) ‖ SHA256(state)(32)');
  assert.throws(() => encodeControllerState({ poolId: Buffer.alloc(31), stateId }), /poolId must be 32B/);
});

test('pool_id = SHA256(minter outpoint) — deterministic + breaks the controllerSPK↔pool_id circularity (outpoint known pre-genesis)', () => {
  const pid = poolIdFromGenesisOutpoint(minterOutpoint);
  assert.ok(pid.equals(S(minterOutpoint)) && pid.length === 32, 'pool_id == SHA256(36B outpoint)');
  assert.ok(!pid.equals(poolIdFromGenesisOutpoint(Buffer.alloc(36, 0x43))), 'a different minter outpoint ⟹ a different pool_id (cross-instance isolation)');
  assert.throws(() => poolIdFromGenesisOutpoint(Buffer.alloc(35)), /must be 36B/);
});

test('controller genesis tx: well-formed (HDR_G 2-input mint shape), pool_id=SHA256(minterOutpoint), state_id=pool_id (toy)', () => {
  const g = controllerGenesisTx({ CG, controllerSPK, VALUE_0: 1_000_000n, feeOut, minterOutpoint, changeVal: 5000, changeSPK });
  assert.ok(g.poolId.equals(S(minterOutpoint)), 'pool_id derived from the minter outpoint');
  assert.ok(g.stateId.equals(g.poolId), 'toy: state_id == pool_id (stable pool identity)');
  assert.ok(g.genesisTxid.equals(S(S(g.tx))), 'genesisTxid = hash256(legacy tx)');
  // structure: HDR_G(5) ‖ minterOutpoint(36) ‖ genMid(CG)(47) ‖ tokenNote0(43) ‖ stateOut0(43) ‖ feeOut(43) ‖ change(43) ‖ locktime(4).
  assert.equal(g.tx.length, 5 + 36 + 47 + 43 + 43 + feeOut.length + 43 + 4, 'genesis byte length matches the pinned sub-pieces');
  assert.ok(g.tx.subarray(5, 41).equals(minterOutpoint), 'vin0 = minter outpoint');
  // out0 (the controller note) = VALUE_0 ‖ 0x22 ‖ controllerSPK at offset 5+36+47.
  const o0 = 5 + 36 + 47;
  assert.ok(g.tx.subarray(o0, o0 + 8).equals(u64(1_000_000n)) && g.tx.subarray(o0 + 9, o0 + 43).equals(controllerSPK), 'out0 pays VALUE_0 to controllerSPK');
  assert.ok(g.tx.subarray(o0 + 43, o0 + 86).equals(g.stateOut0), 'out1 = the controller stateOut0 (commits pool_id ‖ state_id)');
});

test('a sibling controller (different minter outpoint) gets a DIFFERENT pool_id ⟹ would get a different controllerSPK (cross-instance)', () => {
  const a = controllerGenesisTx({ CG, controllerSPK, VALUE_0: 1_000_000n, feeOut, minterOutpoint, changeVal: 5000, changeSPK });
  const b = controllerGenesisTx({ CG, controllerSPK, VALUE_0: 1_000_000n, feeOut, minterOutpoint: Buffer.alloc(36, 0x43), changeVal: 5000, changeSPK });
  assert.ok(!a.poolId.equals(b.poolId), 'distinct pool_ids ⟹ the controller leaf (which bakes pool_id) ⟹ distinct controllerSPK');
});
