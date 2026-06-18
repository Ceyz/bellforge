// P2-5 INTEGRATION — conservation + the c6=sha_outputs bind in ONE leaf, single-source (scriptsim; the epilogue then binds c6
// to the real sighash). Proves: c6 is built byte-exact (== a real split tx's shaOutputs) FROM the same gadget-welded output
// amounts whose b_num feeds Σ(outputs)==input — so the value summed == the value in each stateOut, in ONE pass.
// Run: node --test native/p2_5_bind_c6.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState } from './wire.mjs';
import { u64, varslice } from './sighashParts.mjs';
import { splitBindC6Ops } from './p2_5Covenant.mjs';

const S = bells.crypto.sha256, enc = bells.script.number.encode, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x22);
const limbs = (v) => { const a = []; for (let i = 0; i < N; i++) a.push(Number((BigInt(v) >> BigInt(8 * i)) & 0xffn)); return a; };

function witness(outs, changeValue, { targetOverride } = {}) {
  const M = outs.length, tgt = targetOverride !== undefined ? BigInt(targetOverride) : outs.reduce((a, o) => a + o.amount, 0n);
  const w = [u64(changeValue)];
  for (const o of outs) w.push(o.owner, u64(o.value));
  for (let j = 0; j < M; j++) { const L = limbs(outs[j].amount); for (let i = 0; i < N; i++) w.push(enc(L[i]), Buffer.from([L[i]])); }
  const tl = limbs(tgt); for (let i = 0; i < N; i++) w.push(enc(tl[i]), Buffer.from([tl[i]]));
  return w;
}
function realShaOutputs(outs, changeValue) {
  const r = [];
  for (const o of outs) { r.push({ value: o.value, script: ownSPK }); r.push({ value: 0n, script: Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId, amount: o.amount, owner: o.owner })) ]) }); }
  r.push({ value: changeValue, script: changeSPK });
  return S(Buffer.concat(r.map((o) => Buffer.concat([u64(o.value), varslice(o.script)]))));
}
const run = (M, w) => runScript(splitBindC6Ops(M, N, { tokenId, ownSPK, changeSPK }), w);
const rejects = (M, w) => { try { run(M, w); return false; } catch { return true; } };

test('P2-5 integration: c6 built single-source == real shaOutputs AND Σ(outputs)==input, in one leaf (M=2)', () => {
  const outs = [{ value: 80000n, owner: Buffer.alloc(20, 0xa0), amount: 7_000_000n }, { value: 60000n, owner: Buffer.alloc(20, 0xb0), amount: 14_000_000n }];
  const r = run(2, witness(outs, 9000n));
  assert.ok(r.main[r.main.length - 1].equals(realShaOutputs(outs, 9000n)), 'c6 must equal the real split tx shaOutputs');
});

test('P2-5 integration: M=3 c6 byte-exact + conserving', () => {
  const outs = Array.from({ length: 3 }, (_, j) => ({ value: BigInt(10000 * (j + 1)), owner: Buffer.alloc(20, 0x10 + j), amount: BigInt(3_000_000 * (j + 1)) }));
  const r = run(3, witness(outs, 5000n));
  assert.ok(r.main[r.main.length - 1].equals(realShaOutputs(outs, 5000n)));
});

test('P2-5 integration: inflation (Σ outputs > committed input) is rejected by the conservation', () => {
  const outs = [{ value: 80000n, owner: Buffer.alloc(20, 0xa0), amount: 7_000_000n }, { value: 60000n, owner: Buffer.alloc(20, 0xb0), amount: 14_000_000n }];
  assert.ok(rejects(2, witness(outs, 9000n, { targetOverride: 21_000_001n })), 'Σ outputs > input must reject');
});

test('P2-5 integration: a tampered output b_ser (summed≠stated) is rejected by the gadget weld', () => {
  const outs = [{ value: 80000n, owner: Buffer.alloc(20, 0xa0), amount: 7_000_000n }, { value: 60000n, owner: Buffer.alloc(20, 0xb0), amount: 14_000_000n }];
  const w = witness(outs, 9000n);
  w[1 + 2 * 2 + 1] = Buffer.from([99]); // out0 limb0 b_ser corrupted (abs = base(1+2M=5) + 1), b_num unchanged -> gadget abort
  assert.ok(rejects(2, w), 'a divergent (b_num,b_ser) must abort at the gadget weld (single-source)');
});
