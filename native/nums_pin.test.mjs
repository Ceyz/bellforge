// P2-0 FREEZE — the NUMS internal-key PIN (a genesis freeze-blocker). The $BOUND taptree's internal key MUST be a nothing-up-my-sleeve
// point with UNKNOWN discrete log: a taproot output key is Q = lift_x(NUMS) + t·G, and ANYONE who knows dlog(lift_x(NUMS)) can produce a
// key-path signature for Q — bypassing EVERY enumerated leaf = total theft of all supply. This consolidates the NUMS guarantees into ONE
// auditable file: (1) the reproducible derivation NUMS = SHA256(SEC1-uncompressed G), with the exact-encoding NEGATIVES; (2) it equals the
// published BIP-341 'H' x-coordinate (a literal anchor, catches a typo in either the const or the derivation); (3) it is a liftable
// on-curve x-only point; (4) the production const == the from-scratch independent re-derivation (2nd validator). The on-node proof that the
// key-path is ACTUALLY dead (a NUMS-tweaked note rejects a key-path spend at consensus) is freeze_spend_regtest.test surface 'R'.
// Doc (auditor-facing, reproducible): docs/NUMS_PIN.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { NUMS } from './freezeEnumerate.mjs';
import { NUMS_INDEP } from './independentRoot.mjs';

const S = bells.crypto.sha256;
// the secp256k1 generator G (SEC1 affine coords) — PUBLIC, fixed curve constants; NOBODY chose them.
const Gx = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const Gy = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
// the published BIP-341 'H' point x-coordinate — the SAME NUMS point used across Bitcoin taproot (not a project-specific magic number).
const BIP341_H_X = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

test('NUMS derivation: x == SHA256(uncompressed G = 0x04‖Gx‖Gy) — the nothing-up-my-sleeve preimage', () => {
  const uncompressed = Buffer.from('04' + Gx + Gy, 'hex');               // SEC1 uncompressed encoding of G (65 bytes)
  assert.equal(uncompressed.length, 65, 'preimage = 1-byte tag (0x04) + 32B Gx + 32B Gy');
  assert.ok(NUMS.equals(S(uncompressed)), 'NUMS == SHA256(0x04 ‖ Gx ‖ Gy)');
  // NEGATIVES — pin the EXACT encoding so an auditor has no ambiguity (the OTHER plausible encodings must NOT produce NUMS).
  assert.ok(!NUMS.equals(S(Buffer.from('02' + Gx, 'hex'))), 'NOT SHA256(compressed 0x02‖Gx)');
  assert.ok(!NUMS.equals(S(Buffer.from('03' + Gx, 'hex'))), 'NOT SHA256(compressed 0x03‖Gx)');
  assert.ok(!NUMS.equals(S(Buffer.from(Gx, 'hex'))), 'NOT SHA256(bare Gx)');
});

test('NUMS == the published BIP-341 H x-coordinate (literal anchor)', () => {
  assert.equal(NUMS.toString('hex'), BIP341_H_X, 'the baked NUMS const equals the canonical BIP-341 H point');
  assert.equal(NUMS.length, 32, 'NUMS is a 32B x-only key');
});

test('NUMS is a liftable on-curve x-only point (a curve point with x == NUMS exists)', () => {
  // lift via a real TapTweak add: a non-liftable x-only key makes lift_x fail ⟹ xOnlyPointAddTweak returns null. A liftable x yields a
  // 32B x-only output key. (Not every 32B value is a valid x-coordinate; NUMS being on-curve is REQUIRED for a usable taproot output.)
  const t = bells.crypto.taggedHash('TapTweak', Buffer.concat([NUMS, Buffer.alloc(32)]));
  const lifted = ecc.xOnlyPointAddTweak(NUMS, t);
  assert.ok(lifted && lifted.xOnlyPubkey && lifted.xOnlyPubkey.length === 32, 'NUMS lifts to a valid (even-Y) curve point');
});

test('NUMS pin: the production const == the INDEPENDENT from-scratch re-derivation (2nd validator)', () => {
  // independentRoot.NUMS_INDEP recomputes SHA256(0x04‖Gx‖Gy) with its OWN literals; agreement means the root-derivation pipeline
  // and the production const cannot silently disagree on the internal key (an audit-relevant cross-check, the Result-6 discipline).
  assert.ok(NUMS.equals(NUMS_INDEP), 'freezeEnumerate.NUMS == independentRoot.NUMS_INDEP');
});
