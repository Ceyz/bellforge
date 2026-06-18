// Verify the OP_IF/OP_NOTIF/OP_ELSE/OP_ENDIF + MINIMALIF support added to scriptsim.mjs.
// No regtest node needed. Run: node --test scriptsim_if.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';

const O = bells.opcodes;
const TRUE = Buffer.from([1]);
const FALSE = Buffer.alloc(0);
const A = Buffer.from([0xaa]);
const B = Buffer.from([0xbb]);

test('OP_IF takes the THEN branch on 0x01, skips ELSE', () => {
  // selector(0x01) IF push(A) ELSE push(B) ENDIF  => stack [A]
  const r = runScript([TRUE, O.OP_IF, A, O.OP_ELSE, B, O.OP_ENDIF], [], null);
  assert.ok(r.ok && r.main.length === 1 && r.main[0].equals(A), `expected [A], got ${r.main.map((x) => x.toString('hex'))}`);
});

test('OP_IF takes the ELSE branch on empty(false)', () => {
  const r = runScript([FALSE, O.OP_IF, A, O.OP_ELSE, B, O.OP_ENDIF], [], null);
  assert.ok(r.ok && r.main.length === 1 && r.main[0].equals(B), `expected [B], got ${r.main.map((x) => x.toString('hex'))}`);
});

test('OP_NOTIF inverts', () => {
  const r = runScript([FALSE, O.OP_NOTIF, A, O.OP_ELSE, B, O.OP_ENDIF], [], null);
  assert.ok(r.ok && r.main[0].equals(A), 'NOTIF(false) should take THEN');
});

test('MINIMALIF rejects a non-minimal selector (0x02)', () => {
  assert.throws(() => runScript([Buffer.from([0x02]), O.OP_IF, A, O.OP_ENDIF], [], null), /MINIMALIF/);
});

test('MINIMALIF rejects 0x0001 and 0x80', () => {
  assert.throws(() => runScript([Buffer.from([0x00, 0x01]), O.OP_IF, A, O.OP_ENDIF], [], null), /MINIMALIF/);
  assert.throws(() => runScript([Buffer.from([0x80]), O.OP_IF, A, O.OP_ENDIF], [], null), /MINIMALIF/);
});

test('skipped branch does NOT touch the stack (no underflow on skipped ops)', () => {
  // ELSE branch has an OP_CAT that would underflow if executed; THEN is taken so it must be skipped.
  const r = runScript([TRUE, O.OP_IF, A, O.OP_ELSE, O.OP_CAT, O.OP_CAT, O.OP_ENDIF], [], null);
  assert.ok(r.ok && r.main[0].equals(A), 'skipped ELSE ops must not run');
});

test('nested OP_IF tracks correctly', () => {
  // outer TRUE { inner FALSE { A } else { B } } -> B
  const r = runScript([TRUE, O.OP_IF, FALSE, O.OP_IF, A, O.OP_ELSE, B, O.OP_ENDIF, O.OP_ENDIF], [], null);
  assert.ok(r.ok && r.main[0].equals(B), `nested expected [B], got ${r.main.map((x) => x.toString('hex'))}`);
});

test('unbalanced IF (missing ENDIF) throws', () => {
  assert.throws(() => runScript([TRUE, O.OP_IF, A], [], null), /unbalanced/);
});

test('OP_ELSE/OP_ENDIF without OP_IF throws', () => {
  assert.throws(() => runScript([O.OP_ENDIF], [], null), /without OP_IF/);
});

// OP_PICK / OP_ROLL (consensus-proven in canaries/pick_roll.test.mjs) — scriptsim must match.
test('OP_PICK copies the n-back item to the top (n=1 on [AA,BB] -> AA)', () => {
  // [AA, BB] OP_1 OP_PICK -> [AA, BB, AA] ; drop BB,AA top via 2DROP, leave AA truthy... assert via EQUAL.
  const r = runScript([A, B, O.OP_1, O.OP_PICK], [], null);
  assert.equal(r.main.length, 3, 'PICK pushes a copy');
  assert.ok(r.main[2].equals(A) && r.main[0].equals(A) && r.main[1].equals(B), `expected [A,B,A], got ${r.main.map((x) => x.toString('hex'))}`);
});

test('OP_ROLL moves the n-back item to the top (n=1 on [AA,BB] -> [BB,AA])', () => {
  const r = runScript([A, B, O.OP_1, O.OP_ROLL], [], null);
  assert.equal(r.main.length, 2, 'ROLL does not grow the stack');
  assert.ok(r.main[0].equals(B) && r.main[1].equals(A), `expected [B,A], got ${r.main.map((x) => x.toString('hex'))}`);
});

test('OP_PICK out-of-range index throws', () => {
  assert.throws(() => runScript([A, O.OP_2, O.OP_PICK], [], null), /out of range/);
});
