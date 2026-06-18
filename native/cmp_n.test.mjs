// cmpN — limb-wise comparator (MSB-first first-difference latch). GREEN proves the latched value's sign == sign(X−Y) across
// orderings that differ at every limb position, ties, and equals; and that cmpGEVerify HALTS exactly when X < Y.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { cmpOps, cmpGEVerifyOps, cmpRef, cmpWitness } from './mulGadget.mjs';

const dec = (b) => bells.script.number.decode(b, 4, true);
const limbsLE = (x, n) => { const o = []; let v = BigInt(x); for (let i = 0; i < n; i++) { o.push(Number(v & 0xffn)); v >>= 8n; } return o; };

function runCmp(X, Y) {
  const { ops } = cmpOps(X.length);
  const r = runScript(ops, cmpWitness(X, Y));
  return Math.sign(dec(r.main[r.main.length - 1]));     // sign of the latched first-diff (top of stack)
}

test('cmpN — sign(latched diff) == sign(X−Y) across differing positions', () => {
  const n = 16;
  const pairs = [
    [0n, 0n], [1n, 0n], [0n, 1n], [1n, 1n],
    [255n, 254n], [254n, 255n],
    [1n << 120n, (1n << 120n) - 1n],                    // differ only at the top limb
    [(1n << 64n), (1n << 64n) + 1n],                    // differ at a middle limb, X<Y
    [(1n << 64n) + 5n, (1n << 64n) + 5n],               // equal
    [(1n << 127n) - 1n, 1n],                            // huge vs tiny
    [0x0102030405060708090a0b0c0d0e0f10n, 0x0102030405060708090a0b0c0d0e0f0fn], // differ at LSB only
  ];
  for (const [x, y] of pairs) {
    const X = limbsLE(x, n), Y = limbsLE(y, n);
    assert.equal(runCmp(X, Y), cmpRef(X, Y), `cmp ${x} ? ${y}`);
    assert.equal(cmpRef(X, Y), Math.sign(x < y ? -1 : x > y ? 1 : 0));
  }
});

test('cmpN — the latch is MSB-first (a bigger MSB beats a smaller LSB)', () => {
  const n = 4;
  // X = 0x01_00_00_FF, Y = 0x00_FF_FF_00 : X's top limb (01) > Y's top limb (00) ⟹ X>Y despite Y's bigger low bytes.
  const X = limbsLE(0x010000ffn, n), Y = limbsLE(0x00ffff00n, n);
  assert.equal(runCmp(X, Y), 1);
  assert.equal(cmpRef(X, Y), 1);
});

test('cmpGEVerify — passes iff X ≥ Y, HALTS when X < Y', () => {
  const n = 16;
  const ge = (x, y) => { const { ops } = cmpGEVerifyOps(n); return runScript(ops, cmpWitness(limbsLE(x, n), limbsLE(y, n))); };
  assert.doesNotThrow(() => ge(5n, 5n), 'X==Y must pass ≥');
  assert.doesNotThrow(() => ge(6n, 5n), 'X>Y must pass ≥');
  assert.doesNotThrow(() => ge(1n << 100n, (1n << 100n) - 1n), 'X>Y (top limb) must pass');
  assert.throws(() => ge(5n, 6n), /VERIFY/, 'X<Y must HALT the invariant');
  assert.throws(() => ge((1n << 100n) - 1n, 1n << 100n), /VERIFY/, 'X<Y (top limb) must HALT');
});

test('cmpN — BUDGET', () => {
  const { ops, opCount } = cmpOps(16);
  const r = runScript(ops, cmpWitness(limbsLE((1n << 128n) - 1n, 16), limbsLE(0n, 16)));
  console.log(`\n  [cmpN 16-limb budget] ops=${opCount}  peakStack=${r.peakStack}`);
  assert.ok(r.peakStack < 1000);
});
