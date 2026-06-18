// P2-1a OFF-CHAIN differential — the byte-limb consistency reference over the FULL 0..255 edge set (the gadget itself is
// arithmetic, so scriptsim cannot model it; the consensus enforcement is proven in amounts_consensus.test.mjs on the node).
// Run: node --test native/amounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { limbSer, limbNum, limbConsistent, amountLimbs } from './amounts.mjs';

const enc = bells.script.number.encode;

test('P2-1a reference: every canonical limb (b_ser, b_num) for v in 0..255 is consistent', () => {
  for (let v = 0; v <= 255; v++) assert.ok(limbConsistent(limbSer(v), limbNum(v)), `canonical v=${v} must be consistent`);
});

test('P2-1a reference: a DECOUPLED pair (b_ser of v, b_num of w, v!=w) is NEVER consistent — full 256x256 differential', () => {
  let decoupledChecked = 0;
  for (let v = 0; v <= 255; v++) {
    for (let w = 0; w <= 255; w++) {
      const expected = v === w;
      assert.equal(limbConsistent(limbSer(v), limbNum(w)), expected, `consistent(ser=${v}, num=${w}) must be ${expected}`);
      if (v !== w) decoupledChecked++;
    }
  }
  assert.equal(decoupledChecked, 256 * 255, 'all decoupled pairs swept');
});

test('P2-1a edge encodings: the CScriptNum guard-byte boundaries are exactly as the gadget assumes', () => {
  assert.deepEqual(limbNum(0), Buffer.alloc(0), 'enc(0) is the empty push');
  assert.deepEqual(limbNum(1), Buffer.from([0x01]));
  assert.deepEqual(limbNum(127), Buffer.from([0x7f]), '127 is 1 byte (top bit clear)');
  assert.deepEqual(limbNum(128), Buffer.from([0x80, 0x00]), '128 NEEDS the 0x00 guard byte (else it is -0)');
  assert.deepEqual(limbNum(200), Buffer.from([0xc8, 0x00]));
  assert.deepEqual(limbNum(255), Buffer.from([0xff, 0x00]));
  // the gadget's b_ser is always exactly 1 byte
  for (const v of [0, 1, 127, 128, 200, 255]) assert.equal(limbSer(v).length, 1);
});

test('P2-1a malformed reps are rejected by the reference', () => {
  assert.equal(limbConsistent(Buffer.alloc(2, 1), limbNum(1)), false, 'b_ser must be exactly 1 byte');
  assert.equal(limbConsistent(Buffer.alloc(0), limbNum(0)), false, 'b_ser must be 1 byte even for zero (0x00, not empty)');
  assert.equal(limbConsistent(limbSer(1), Buffer.from([0x01, 0x00])), false, 'a NON-minimal b_num (0x0100 for 1) is inconsistent');
  assert.equal(limbConsistent(limbSer(128), Buffer.from([0x80])), false, 'b_num 0x80 decodes to -0, not 128 — inconsistent');
});

test('P2-1a amountLimbs: 8 LE base-256 limbs reconstruct the 8-byte amount_ser', () => {
  for (const v of [0n, 1n, 255n, 256n, 21_000_000n, (1n << 63n) - 1n, (1n << 64n) - 1n]) {
    const limbs = amountLimbs(v);
    assert.equal(limbs.length, 8);
    const ser = Buffer.concat(limbs.map((b) => Buffer.from([b]))); // b0..b7 = LE
    const ref = Buffer.alloc(8); ref.writeBigUInt64LE(v);
    assert.ok(ser.equals(ref), `limbs of ${v} must reconstruct the 8-byte LE amount_ser`);
    // and each limb's canonical (ser,num) is consistent
    for (const b of limbs) assert.ok(limbConsistent(limbSer(b), limbNum(b)));
  }
});
