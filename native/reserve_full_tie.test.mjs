// Full-reserve single-source bridges — tie a uint64 reserve's 8 wire bytes to its mulN limbs (B-input uint8 ×8 / A-input uint16 ×4).
// GREEN: a consistent (bytes ↔ limbs) passes. RED: a limb or byte-num that doesn't match its wire byte is rejected. VERIFY-ONLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { reserveBTieVerifyOps, reserveATieVerifyOps } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const B = (n) => Buffer.from([n]);
const bytesLE = (v, n) => { const o = []; let x = BigInt(v); for (let i = 0; i < n; i++) { o.push(Number(x & 0xffn)); x >>= 8n; } return o; };
const limbs16 = (v, na) => { const o = []; let x = BigInt(v); for (let i = 0; i < na; i++) { o.push(Number(x & 0xffffn)); x >>= 16n; } return o; };

const V = 0x123456789abcdef0n;                 // a uint64 reserve with several ≥0x80 bytes (exercises the guard)
const ser = bytesLE(V, 8);                      // 8 LE byte values

test('reserveBTie — 8 bytes ↔ 8 uint8 limbs (the b-input single-source)', () => {
  // witness: ser[0..7] (wire bytes), then num[0..7] (the uint8 limbs = the byte nums). serBase=0, numBase=8.
  const w = [...ser.map(B), ...ser.map(enc)];
  const { ops } = reserveBTieVerifyOps({ serBase: 0, numBase: 8, startDepth: 16 });
  assert.doesNotThrow(() => runScript(ops, w), 'consistent bytes↔nums must tie');
  const bad = [...ser.map(B), ...ser.map(enc)]; bad[8] = enc((ser[0] + 1) & 0xff);   // forge num[0]
  assert.throws(() => runScript(ops, bad), /EQUALVERIFY|WITHIN/, 'a num that mismatches its byte must HALT');
});

test('reserveATie — 8 bytes ↔ 4 uint16 limbs (the a-input single-source)', () => {
  // witness: ser[0..7], num[0..7] (byte nums), A[0..3] (uint16 limbs). serBase=0, numBase=8, limbBase=16.
  const A = limbs16(V, 4);
  const w = [...ser.map(B), ...ser.map(enc), ...A.map(enc)];
  const { ops } = reserveATieVerifyOps({ serBase: 0, limbBase: 16, numBase: 8, startDepth: 20 });
  assert.doesNotThrow(() => runScript(ops, w), 'consistent bytes↔uint16 limbs must tie');
  const bad = [...ser.map(B), ...ser.map(enc), ...A.map(enc)]; bad[16] = enc(A[0] ^ 1);  // forge A[0]
  assert.throws(() => runScript(ops, bad), /NUMEQUALVERIFY/, 'an A-limb that mismatches its 2 bytes must HALT');
});
