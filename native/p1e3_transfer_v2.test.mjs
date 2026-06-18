// P2-0 BRICK 5 — the 1→1 SEND-ALL v2 leaf. scriptsim with a byte-exact v2 sighash: spend a KEY split-child → ONE note carrying the
// FULL amount (amount_out == amount_in), retargeting the owner (and optionally owner_type: key→key transfer OR key→script deposit).
// Run: node --test native/p1e3_transfer_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { transferSendAllV2Ops, transferSendAllV2Witness } from './p1e3TransferV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

function buildTxP(Mp, j, amountIn, jType = OwnerType.KEY) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? jType : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x42)), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

// out = the single re-emitted note {owner, value, ownerType}; outAmount = its committed amount (== amountIn for a valid send-all).
function trySpend({ Mp, j, txp, out, amountIn, outAmount }) {
  const committedAmount = outAmount !== undefined ? outAmount : amountIn;
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const changeValue = 15000;
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(committedAmount, out.owner, out.ownerType) }, { value: changeValue, script: changeSPK }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = transferSendAllV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn: committedAmount });
  return runScript(transferSendAllV2Ops(Mp, j, N, consts).ops, w, sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

test('1→1 v2 GREEN: key→key transfer (full amount re-emitted, new owner)', () => {
  for (const j of [0, 1]) {
    const txp = buildTxP(2, j, 21_000_000n);
    assert.ok(trySpend({ Mp: 2, j, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n }).ok, `key→key j=${j}`);
  }
});

test('1→1 v2 GREEN: key→script DEPOSIT (the send-all retargets owner_type)', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(trySpend({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xb0), value: 250000, ownerType: OwnerType.SCRIPT }, amountIn: 21_000_000n }).ok, 'key→script deposit');
});

test('1→1 v2 RED inflation: amount_out != amount_in rejects (conservation byte-equality)', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(rejects({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n, outAmount: 21_000_001n }), 'inflated send-all rejects');
});

test('1→1 v2 RED owner_type_in!=KEY: a SCRIPT note via the KEY 1→1 leaf rejects', () => {
  const txp = buildTxP(2, 1, 21_000_000n, OwnerType.SCRIPT);
  assert.ok(rejects({ Mp: 2, j: 1, txp, out: { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn: 21_000_000n }), 'SCRIPT note via KEY 1→1 rejects');
});

test('1→1 v2 leaf size reported', () => {
  const leaf = bells.script.compile(transferSendAllV2Ops(2, 0, N, consts).ops);
  console.log(`  1→1 send-all v2 leaf (KEY) M'=2 j=0: ${leaf.length}B`);
  assert.ok(leaf.length > 0);
});
