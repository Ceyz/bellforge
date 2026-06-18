// P2-0 BRICK 5 — the 1→1 SEND-ALL leaf WITH a grandparent arm (fund-safe transfer of a split-child under a proven lineage). The
// v2 grandparent prefixes are REUSED (leafWtotal = transferV2Wtotal(Mp)) above the 660B 1→1 leaf. scriptsim: genesis(v2) →
// split(v2) → 1→1-transfer a KEY child j. Run: node --test native/p1e3_transfer_grandparent_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { transferSendAllV2Witness } from './p1e3TransferV2.mjs';
import { transferGenesisGrandparentV2Ops, transferSplitGrandparentV2Ops, genesisGrandparentV2, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

function buildTxP(Mp, j, amountIn, committedTxidGP, voutInGp) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(2_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidGP, voutInGp, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

function spend1to1(Mp, j, txp, gpPieces, ops, outOwnerType) {
  const amountIn = 14_000_000n;
  const out = { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: outOwnerType };
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const changeValue = 15000;
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: changeValue, script: changeSPK }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = transferSendAllV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn });
  return runScript(ops, [...w, ...gpPieces], sighash);
}

test('1→1 + GENESIS grandparent GREEN: mint(v2) → split → 1→1-transfer KEY child j (key→key)', () => {
  for (const j of [0, 1]) {
    const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
    const txp = buildTxP(2, j, 14_000_000n, hash256(gp.txGP), 0);
    assert.ok(spend1to1(2, j, txp, gp.pieces, transferGenesisGrandparentV2Ops(2, j, N, consts), OwnerType.KEY).ok, `genesis 1→1 j=${j}`);
  }
});

test('1→1 + SPLIT grandparent GREEN: split(v2) → split → 1→1-transfer KEY child j (key→script deposit)', () => {
  const Mp_gp = 2, jprime = 1;
  const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: k % 3 }));
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime, kids, changeValGp: 7000 });
  const txp = buildTxP(2, 0, 14_000_000n, hash256(gp.txGP), 2 * jprime);
  assert.ok(spend1to1(2, 0, txp, gp.pieces, transferSplitGrandparentV2Ops(2, 0, N, Mp_gp, consts), OwnerType.SCRIPT).ok, 'split 1→1 deposit');
});
