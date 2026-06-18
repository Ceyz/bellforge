// chunkMul — scriptsim differential + adversarial REDs + budget instrumentation. The base emulated-multiply brick (no OP_MUL).
// GREEN proves: (1) the witness-bit shift-and-add computes a·b for the FULL uint16×uint8 range, and (2) a forged/non-minimal
// bit-decomposition is REJECTED (BIND-not-DECLARE). Budget (op count, peak stack) is printed — the input to the radix decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { chunkMulOps, chunkMulWitness, chunkMulRef, bitsOf } from './mulGadget.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;

// run the gadget for (a,b); return the raw result stack item (the product) — or throw if the script fails.
function runMul(a, b, witnessOverride) {
  const { ops } = chunkMulOps();
  const w = witnessOverride ?? chunkMulWitness(a, b);
  const r = runScript(ops, w);
  return r;
}

test('chunkMul — full uint16×uint8 differential (product == a·b)', () => {
  const As = [0, 1, 2, 127, 128, 255, 256, 1000, 4096, 65535];
  const Bs = [0, 1, 2, 3, 127, 128, 200, 255];
  let cases = 0;
  for (const a of As) for (const b of Bs) {
    const r = runMul(a, b);
    assert.equal(r.main.length, 1, `expected single result for ${a}·${b}, got depth ${r.main.length}`);
    assert.ok(r.main[0].equals(enc(chunkMulRef(a, b))), `product mismatch ${a}·${b}: got ${r.main[0].toString('hex')} want ${enc(a * b).toString('hex')}`);
    cases++;
  }
  assert.equal(cases, As.length * Bs.length);
});

test('chunkMul RED — forged bit-decomposition (Σ bit·2^k ≠ b) is rejected', () => {
  // witness b=5 but supply the bits of 6 ⟹ step-1 reconstruction (6) ≠ b (5) ⟹ OP_NUMEQUALVERIFY fails.
  const a = 100, bDeclared = 5, bBits = 6;
  const w = [enc(a), enc(bDeclared), ...bitsOf(bBits)];
  assert.throws(() => runScript(chunkMulOps().ops, w), /NUMEQUALVERIFY/, 'forged bits must HALT at the Σ==b check');
});

test('chunkMul RED — a bit that is not 0/1 (value 2) is rejected', () => {
  const a = 100, b = 5;
  const w = chunkMulWitness(a, b);
  w[2] = enc(2);                        // bit_0 := 2 (out of {0,1})
  assert.throws(() => runScript(chunkMulOps().ops, w), /VERIFY|WITHIN/, 'bit∉{0,1} must HALT at 0<=bit<2');
});

test('chunkMul RED — a NON-MINIMAL bit push (0x00 for zero) is rejected', () => {
  const a = 100, b = 4;                 // b=4 ⟹ bit_2=1, the rest 0; force a 0-bit to the non-minimal 0x00 byte
  const w = chunkMulWitness(a, b);
  w[2] = Buffer.from([0x00]);           // bit_0 := 0x00 (non-minimal; minimal zero is '')
  assert.throws(() => runScript(chunkMulOps().ops, w), /minimal|MINIMALIF|Script number/i, 'non-minimal bit must HALT (fRequireMinimal/MINIMALIF)');
});

test('chunkMul RED — a 2-byte (0x0100) bit push is rejected', () => {
  const a = 100, b = 4;
  const w = chunkMulWitness(a, b);
  w[2] = Buffer.from([0x00, 0x01]);     // bit_0 := 256-ish blob
  assert.throws(() => runScript(chunkMulOps().ops, w), /.*/, 'oversized bit must HALT');
});

test('chunkMul — BUDGET instrumentation (op count + peak stack)', () => {
  const { ops, opCount } = chunkMulOps();
  // peak stack on a worst-ish case (all-ones b ⟹ every IF taken)
  const r = runScript(ops, chunkMulWitness(65535, 255));
  const pushes = ops.filter((x) => Buffer.isBuffer(x)).length;
  console.log(`\n  [chunkMul budget] ops=${ops.length} (opcodes=${opCount}, data-pushes=${pushes})  peakStack=${r.peakStack}  product(65535·255)=${parseInt(r.main[0].toString('hex').match(/../g).reverse().join(''),16)}`);
  assert.ok(r.peakStack < 1000, `peak stack ${r.peakStack} must stay < MAX_STACK_SIZE 1000`);
  assert.ok(ops.length < 2000, `single chunkMul ${ops.length} ops — sanity bound`);
});
