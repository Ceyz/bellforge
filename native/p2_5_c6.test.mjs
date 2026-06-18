// P2-5 c6 — the M-way split sha_outputs reconstruction is BYTE-EXACT against a real split tx serialization (the genesis-
// permanent FROZEN output topology: interleaved [tokenOut_j, stateOut_j] per note, then change). Pure/off-chain — the covenant
// rebuilds c6 from amount_ser_j (single-source) + owner_j + value_j; it MUST equal the real shaOutputs the sighash binds.
// Run: node --test native/p2_5_c6.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { u64, varslice } from './sighashParts.mjs';
import { splitC6Ops, splitC6Witness } from './p2_5Covenant.mjs';

const S = bells.crypto.sha256;
const p2tr = (fill) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x22);

// the REAL shaOutputs of an M-way split tx, FROZEN order: [tokenOut_0, stateOut_0, ..., tokenOut_{M-1}, stateOut_{M-1}, change]
function realShaOutputs(outs, changeValue) {
  const real = [];
  for (const o of outs) {
    real.push({ value: o.value, script: ownSPK });
    real.push({ value: 0n, script: Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId, amount: o.amount, owner: o.owner })) ]) });
  }
  real.push({ value: changeValue, script: changeSPK });
  return S(Buffer.concat(real.map((o) => Buffer.concat([u64(o.value), varslice(o.script)]))));
}

function reconstruct(M, outs, changeValue) {
  const w = splitC6Witness({ outs: outs.map((o) => ({ value: o.value, owner: o.owner, amountSer: encodeAmount(o.amount) })), changeValue });
  const r = runScript(splitC6Ops(M, { tokenId, ownSPK, changeSPK }), w);
  assert.equal(r.main.length, 1, 'splitC6Ops must leave exactly c6 on the stack');
  return r.main[0];
}

test('P2-5 c6: M=2 split reconstruction == real shaOutputs (byte-exact, frozen interleaved topology)', () => {
  const outs = [{ value: 80000n, owner: Buffer.alloc(20, 0xa0), amount: 7_000_000n }, { value: 60000n, owner: Buffer.alloc(20, 0xb0), amount: 14_000_000n }];
  assert.ok(reconstruct(2, outs, 9000n).equals(realShaOutputs(outs, 9000n)), 'reconstructed c6 must equal the real shaOutputs');
});

test('P2-5 c6: M=3 and M=4 reconstructions are byte-exact', () => {
  for (const M of [3, 4]) {
    const outs = Array.from({ length: M }, (_, j) => ({ value: BigInt(1000 * (j + 1)), owner: Buffer.alloc(20, 0x10 + j), amount: BigInt(1_000_000 * (j + 1)) }));
    assert.ok(reconstruct(M, outs, 5000n).equals(realShaOutputs(outs, 5000n)), `M=${M} c6 must be byte-exact`);
  }
});

test('P2-5 c6: changeSPK == ownSPK is rejected at build time (RED-3b: token-valued change inflation)', () => {
  assert.throws(() => splitC6Ops(2, { tokenId, ownSPK, changeSPK: ownSPK }), /changeSPK MUST differ/);
});

test('P2-5 c6: a wrong amount_ser breaks c6 (the bind detects a mis-stated output amount)', () => {
  const outs = [{ value: 80000n, owner: Buffer.alloc(20, 0xa0), amount: 7_000_000n }, { value: 60000n, owner: Buffer.alloc(20, 0xb0), amount: 14_000_000n }];
  // reconstruct with a TAMPERED amount_ser for output 0 -> c6 diverges from the real shaOutputs (which commits the true amount)
  const w = splitC6Witness({ outs: [{ value: outs[0].value, owner: outs[0].owner, amountSer: encodeAmount(7_000_001n) }, { value: outs[1].value, owner: outs[1].owner, amountSer: encodeAmount(outs[1].amount) }], changeValue: 9000n });
  const c6 = runScript(splitC6Ops(2, { tokenId, ownSPK, changeSPK }), w).main[0];
  assert.ok(!c6.equals(realShaOutputs(outs, 9000n)), 'a tampered amount_ser must produce a c6 != the real shaOutputs (CSFS bind would reject)');
});
