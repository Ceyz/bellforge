// reserveU16TieOps — the single-source bridge (uint16 mulN a-limb ↔ 2 c6 wire bytes). GREEN proves it ACCEPTS every consistent
// (A, lo_ser, hi_ser, lo_num, hi_num) across the full uint16 range incl. the ≥0x80 guard cases, and REJECTS any mismatch (A≠lo+256·hi,
// a ser byte that doesn't match its num, an out-of-range num). VERIFY-ONLY: the inputs survive (net 0) for downstream c6 use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { reserveU16TieOps, reserveU16TieWitness } from './mulGadget.mjs';

const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

test('reserveU16Tie — accepts consistent (A ↔ lo,hi) across the uint16 range', () => {
  const As = [0, 1, 127, 128, 255, 256, 257, 32767, 32768, 0x8000, 0xff00, 0x00ff, 0x1234, 0xabcd, 0xffff];
  for (const A of As) {
    const { ops } = reserveU16TieOps();
    const w = reserveU16TieWitness(A);
    const r = runScript(ops, w);
    assert.equal(r.main.length, 5, `verify-only must leave the 5 inputs for A=${A} (net 0)`);
    assert.ok(r.main.every((b, i) => b.equals(w[i])), `inputs must be unchanged for A=${A}`);
  }
});

test('reserveU16Tie RED — A ≠ lo + 256·hi is rejected', () => {
  const w = reserveU16TieWitness(0x1234);
  w[0] = enc(0x1235);                              // A_num off by one
  assert.throws(() => runScript(reserveU16TieOps().ops, w), /NUMEQUALVERIFY/, 'A≠lo+256·hi must HALT');
});

test('reserveU16Tie RED — lo_ser inconsistent with lo_num is rejected', () => {
  const A = 0x1234;                                // lo=0x34, hi=0x12
  const w = reserveU16TieWitness(A);
  w[1] = B(0x35);                                  // lo_ser := 0x35 ≠ lo_num(0x34)
  assert.throws(() => runScript(reserveU16TieOps().ops, w), /EQUALVERIFY/, 'lo_ser≠lo_num must HALT in limbConsistency');
});

test('reserveU16Tie RED — high byte ≥0x80 with a wrong guard num is rejected', () => {
  const A = 0x8042;                                // hi=0x80, lo=0x42 ; correct hi_num = enc(128) = 0x8000
  const w = reserveU16TieWitness(A);
  w[4] = B(0x80);                                  // hi_num := 0x80 (non-minimal/negative, NOT the guarded enc(128))
  assert.throws(() => runScript(reserveU16TieOps().ops, w), /.*/, 'wrong guard num for a ≥0x80 byte must HALT');
});

test('reserveU16Tie RED — out-of-range num (hi_num=300) is rejected', () => {
  const w = reserveU16TieWitness(0x1234);
  w[4] = enc(300);                                 // hi_num out of [0,256)
  assert.throws(() => runScript(reserveU16TieOps().ops, w), /VERIFY|WITHIN/, 'num≥256 must HALT');
});

test('reserveU16Tie — BUDGET', () => {
  const { ops, opCount } = reserveU16TieOps();
  const r = runScript(ops, reserveU16TieWitness(0xffff));
  console.log(`\n  [reserveU16Tie budget] ops=${opCount}  peakStack=${r.peakStack}`);
  assert.ok(r.peakStack < 1000);
});
