// P2-0 FREEZE blocker — close the TRANSFER-NOTE reachability gap (a CRITICAL permanent-fund-loss: a 1→1 send-all output had NO
// spending kernel ⟹ unspendable forever). Claude's fix (overriding the freeze workflow's heavier new-kernel proposal): a 1→1 tx is a
// degree-1 "split" — HDR_S==HDR_T and splitMid(1)==CONT_MID (verified) — so splitParentReconstructV2Ops(Mp=1, j=0) reconstructs the
// voutCount-3 transfer parent BYTE-EXACT. Just relax the parent-degree bound to ≥1; NO new kernel, NO new leaf family, same 404-leaf
// set. Proves a transfer note is spendable via BOTH split (→ M children) and 1→1 (→ another transfer note). Run: node --test native/p1e3_transfer_note_spend_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Ops, splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { transferSendAllV2Ops, transferSendAllV2Witness } from './p1e3TransferV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// txP = a 1→1 TRANSFER tx (a degree-1 "split"): vin0 ‖ tokenOut0@ownSPK ‖ stateOut0 ‖ change. The transfer note is child 0 @ vout0.
function buildTransferParent(amountIn) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x42)), 0, 0xffffffff);
  tx.addOutput(ownSPK, 80000);                                              // tokenOut0 (the transfer note's sat value)
  tx.addOutput(stateScript(amountIn, owner_in, OwnerType.KEY), 0);          // stateOut0 (KEY-owned, full amount)
  tx.addOutput(changeSPK, 9000);                                            // change
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: 80000,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: [{ value: 80000, amountSer: encodeAmount(amountIn), owner: owner_in, ownerType: OwnerType.KEY }] } };
}

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }]; // Σ=14M (a deposit)

// spend the transfer note (Mp=1, j=0) via SPLIT → M children.
function trySplit({ txp, outs = curOuts, inputVout = 0 }) {
  const amountIn = outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: inputVout, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs, amountIn, N });
  return runScript(splitFullLineageV2Ops(1, 0, 2, N, consts).ops, w, sighash);
}
// spend the transfer note (Mp=1, j=0) via 1→1 → ONE note (chained send-all).
function try1to1({ txp, out = { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, amountIn = 21_000_000n }) {
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: changeValue, script: changeSPK }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 0, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = transferSendAllV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn });
  return runScript(transferSendAllV2Ops(1, 0, N, consts).ops, w, sighash);
}
const rejects = (fn, a) => { try { return !fn(a).ok; } catch { return true; } };

test('GREEN: a TRANSFER note (1→1 output) is SPLIT into M children (Mp=1 reconstructs the voutCount-3 transfer parent)', () => {
  assert.ok(trySplit({ txp: buildTransferParent(14_000_000n) }).ok, 'transfer note → split, the gap is closed');
});

test('GREEN: a TRANSFER note is sent 1→1 AGAIN (chained send-all: mint→1→1→1→1 is now possible)', () => {
  assert.ok(try1to1({ txp: buildTransferParent(21_000_000n) }).ok, 'transfer note → 1→1, chained');
});

test('GREEN: the transfer-note split can deposit key→script (Σ conserved across the transfer-parent base case)', () => {
  assert.ok(trySplit({ txp: buildTransferParent(14_000_000n), outs: curOuts }).ok, 'key→script deposit from a transfer note');
});

test('RED: a forged transfer parent (wrong committedTxidP) rejects', () => {
  const txp = buildTransferParent(14_000_000n);
  txp.parent = { ...txp.parent, committedTxidP: Buffer.alloc(32, 0xee) };
  assert.ok(rejects(trySplit, { txp }), 'wrong committedTxidP rejects (the kernel hash-match)');
});

test('RED: inflation (Σ children != transfer note amount) rejects', () => {
  const txp = buildTransferParent(14_000_000n);
  const inflated = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_001n, ownerType: OwnerType.KEY }];
  assert.ok(rejects(trySplit, { txp, outs: inflated }), 'Σ=14M+1 rejects');
});

test('RED: wrong input vout (transfer note is at vout0) rejects', () => {
  assert.ok(rejects(trySplit, { txp: buildTransferParent(14_000_000n), inputVout: 2 }), 'wrong vout rejects (c2 position)');
});

test('transfer-parent leaf sizes reported', () => {
  console.log(`  split-a-transfer (Mp=1) M=2: ${bells.script.compile(splitFullLineageV2Ops(1, 0, 2, N, consts).ops).length}B`);
  console.log(`  1→1-a-transfer (Mp=1): ${bells.script.compile(transferSendAllV2Ops(1, 0, N, consts).ops).length}B`);
  assert.ok(true);
});
