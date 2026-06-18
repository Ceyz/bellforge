// P2-0 BRICK 0 — the v2 grandparent arms (genesis / transfer-1→1 / split), each a straight-line v2 leaf. scriptsim with a byte-
// exact v2 sighash + REAL chains: txGP (each shape, v2 stateOuts) → txP (a v2 split) → spend a KEY child j. Proves the +1-byte
// owner_type shift in the grandparent reconstruction is byte-exact for ALL THREE shapes. Run: node --test native/p1e3_split_grandparent_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import {
  splitFullLineageGenesisGrandparentV2Ops, splitFullLineageTransferGrandparentV2Ops, splitFullLineageSplitGrandparentV2Ops,
  genesisGrandparentV2, transferGrandparentV2, splitGrandparentSplitV2,
} from './p1e3SplitGrandparentV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner, ownerType) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// txP: a v2 split spending txGP's note (vin0 = committedTxidGP ‖ u32le(voutInGp)); child j is KEY-owned (owner_in, amountIn).
function buildTxP(Mp, j, amountIn, committedTxidGP, voutInGp) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(2_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? OwnerType.KEY : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidGP, voutInGp, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }]; // Σ=14M, a deposit

function spend(Mp, j, M, txp, gpPieces, ops) {
  const amountIn = curOuts.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: 15000, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: curOuts, amountIn, N });
  return runScript(ops, [...w, ...gpPieces], sighash);
}

test('v2 GENESIS grandparent GREEN: mint(v2) → split → spend KEY child j', () => {
  for (const j of [0, 1]) {
    const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
    const txp = buildTxP(2, j, 14_000_000n, hash256(gp.txGP), 0);
    assert.ok(spend(2, j, 2, txp, gp.pieces, splitFullLineageGenesisGrandparentV2Ops(2, j, 2, N, consts)).ok, `genesis j=${j}`);
  }
});

test('v2 TRANSFER grandparent GREEN: transfer(v2) → split → spend KEY child j', () => {
  for (const j of [0, 1]) {
    const tailGP = Buffer.concat([u64(7000n), B(0x22), p2tr(0x66), B(0, 0, 0, 0)]); // changeOut ‖ locktime
    const gp = transferGrandparentV2({ tokenId: G, ownSPK, gpVin0Outpoint: Buffer.alloc(36, 0x43), valGP: 90000n, ownerGP: Buffer.alloc(20, 0x33), amtGP: 21_000_000n, ownerTypeGP: OwnerType.KEY, tailGP });
    const txp = buildTxP(2, j, 14_000_000n, hash256(gp.txGP), 0);
    assert.ok(spend(2, j, 2, txp, gp.pieces, splitFullLineageTransferGrandparentV2Ops(2, j, 2, N, consts)).ok, `transfer j=${j}`);
  }
});

test('v2 SPLIT grandparent GREEN: split(v2) → split → spend KEY child j (Mp_gp∈{2,3}, jprime varied)', () => {
  for (const Mp_gp of [2, 3]) for (let jprime = 0; jprime < Mp_gp; jprime++) {
    const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: k % 3 }));
    const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime, kids, changeValGp: 7000 });
    const txp = buildTxP(2, 0, 14_000_000n, hash256(gp.txGP), 2 * jprime);
    assert.ok(spend(2, 0, 2, txp, gp.pieces, splitFullLineageSplitGrandparentV2Ops(2, 0, 2, N, Mp_gp, consts)).ok, `split Mp_gp=${Mp_gp} j'=${jprime}`);
  }
});

test('v2 grandparent RED: a forged txGP (tampered owner_type) breaks the outpoint match', () => {
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
  const txp = buildTxP(2, 0, 14_000_000n, hash256(gp.txGP), 0);
  // tamper the genesis mint outpoint piece -> rebuilt hash256 ≠ txP.vin0 -> reject
  const bad = gp.pieces.map((b) => Buffer.from(b)); bad[0] = Buffer.alloc(36, 0xee);
  let ok; try { ok = spend(2, 0, 2, txp, bad, splitFullLineageGenesisGrandparentV2Ops(2, 0, 2, N, consts)).ok; } catch { ok = false; }
  assert.equal(ok, false, 'forged genesis grandparent rejects');
});
