// P2-5 lineage-v2 — MEASURE the split-parent byte constants against a REAL belcoinjs split-tx serialization. The position-aware
// backtrace pins tokenOut_j @ splitPreLen(j) and stateOut_j @ +43; a wrong const bricks honest splits or slides a boundary, so
// these are frozen ONLY after this measurement. Run: node --test native/p1e3_split_const.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeState } from './wire.mjs';
import { HDR_S, SPLIT_PAIR_LEN, SPLIT_HEADER_LEN, splitMid, splitVoutCount, splitPreLen, tokenOutOffset, stateOutOffset, LOCKTIME0 } from './p1e3SplitConst.mjs';

const S = bells.crypto.sha256;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId, amount, owner }))]);

// a real split parent: mono-input → [tokenOut_0, stateOut_0, …, tokenOut_{M'-1}, stateOut_{M'-1}, change], legacy serialization.
function splitParentLegacy(Mp) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);
  for (let k = 0; k < Mp; k++) { tx.addOutput(ownSPK, 40000 + k); tx.addOutput(stateScript(BigInt(1_000_000 * (k + 1)), Buffer.alloc(20, 0x10 + k)), 0); }
  tx.addOutput(changeSPK, 9000);
  return tx.toBuffer(); // legacy (no witness) = exactly what the covenant reconstructs + hash256s
}

test('split-parent header is 47B and INDEPENDENT of M′ (voutCount byte = 2M′+1)', () => {
  for (const Mp of [2, 3, 4]) {
    const buf = splitParentLegacy(Mp);
    assert.ok(buf.subarray(0, 5).equals(HDR_S), `HDR_S (version‖vinCount) for M'=${Mp}`);
    // vin0 outpoint at 5..40, scriptSigLen(0x00) at 41, sequence at 42..45, voutCount at 46
    assert.equal(buf[41], 0x00, 'scriptSigLen == 0');
    assert.deepEqual(buf.subarray(42, 46), Buffer.from([0xff, 0xff, 0xff, 0xff]), 'sequence');
    assert.equal(buf[46], 2 * Mp + 1, `voutCount byte == 2M'+1 for M'=${Mp}`);
    assert.ok(splitMid(Mp).equals(buf.subarray(41, 47)), 'splitMid = scriptSigLen‖seq‖voutCount (6B)');
    assert.equal(SPLIT_HEADER_LEN, 47);
  }
});

test('tokenOut_j @ splitPreLen(j)=47+86j and stateOut_j @ +43 land byte-exact at every position', () => {
  for (const Mp of [2, 3, 4]) {
    const buf = splitParentLegacy(Mp);
    for (let j = 0; j < Mp; j++) {
      const to = tokenOutOffset(j), so = stateOutOffset(j);
      assert.equal(to, 47 + 86 * j);
      // tokenOut_j = value(8) ‖ 0x22 ‖ ownSPK(34): the scriptlen 0x22 sits at to+8, ownSPK at to+9
      assert.equal(buf[to + 8], 0x22, `tokenOut_${j} scriptlen 0x22 @ ${to + 8}`);
      assert.ok(buf.subarray(to + 9, to + 9 + 34).equals(ownSPK), `tokenOut_${j} == ownSPK`);
      // stateOut_j = value0(8 zeros) ‖ 0x22 ‖ 0x6a 0x20 ‖ hash32
      assert.equal(so, to + 43);
      assert.deepEqual(buf.subarray(so, so + 8), Buffer.alloc(8), `stateOut_${j} value == 0`);
      assert.equal(buf[so + 8], 0x22); assert.equal(buf[so + 9], 0x6a); assert.equal(buf[so + 10], 0x20);
    }
    // change @ 47+86*M', locktime at the end
    const changeOff = splitPreLen(Mp);
    assert.equal(buf[changeOff + 8], 0x22, 'changeOut scriptlen 0x22 (34B SPK — fund-critical)');
    assert.ok(buf.subarray(buf.length - 4).equals(LOCKTIME0), 'nLockTime == 0');
    assert.equal(SPLIT_PAIR_LEN, 86);
  }
});

test('voutCount stays a 1-byte varint for M′ ≤ 4 (the 47+86j offset formula holds); M′ ≥ 126 throws', () => {
  for (const Mp of [2, 3, 4]) assert.equal(splitVoutCount(Mp).length, 1);
  assert.throws(() => splitVoutCount(126), /1-byte varint/); // 2*126+1=253=0xfd
});
