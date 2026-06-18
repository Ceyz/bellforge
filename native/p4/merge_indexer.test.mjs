// P4 MERGE indexer (brick 6) — the multi-input dispatch, GENESIS-MIRROR (P4 accepts iff the consensus leaf accepts). The merge leaf
// is TIGHT-CAP: both inputs are transfer-notes (provenance='transfer') AT vout0, same owner, and owner_out==owner_in. So the VALID
// scenario is: genesis → split → NORMALIZE each child via 1→1 to the SAME owner → merge the two transfer-notes. The indexer HALTs
// anything else (e.g. a direct merge of split-children at vout0/vout2 with different owners — the GPT-caught over-acceptance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, encodeAmount, OwnerType, EventTypeV2 } from '../wire.mjs';
import { u64 } from '../sighashParts.mjs';
import { buildDeployV2 } from './deploy.mjs';
import { internalTxid } from './predicates.mjs';
import { Indexer } from './indexer.mjs';
import { monoGenesisTx, splitAMonoV2Witness } from '../p1e3MonoGenesisV2.mjs';
import { transferSendAllV2Witness } from '../p1e3TransferV2.mjs';
import { MERGE_OWNER_OUT_IDX } from './mergePredicates.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const ownSPK = p2tr(0x11), changeSPK = p2tr(0x77), changeSPKgp = p2tr(0x88);
const G = Buffer.alloc(36, 0xab), AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n, OWNER_0 = Buffer.alloc(20, 0x55);
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const deploy = buildDeployV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, transferSPK: ownSPK });
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
const TAIL = [Buffer.alloc(40), Buffer.alloc(33)];
const OWNER_Z = Buffer.alloc(20, 0xaa);                                               // the single owner both merge inputs (and the output) carry

const mint = bells.Transaction.fromBuffer(monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp }).tx);
const mintId = internalTxid(mint);
const genesisRef = { genesisTxid: mintId, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp };

function splitAMonoTx(children, changeValue = 15000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(mintId, 0, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  tx.ins[0].witness = [...splitAMonoV2Witness({ genesis: genesisRef, epi, ownSPK, changeValue, outs: children, amountIn: AMOUNT_0, N }), ...TAIL];
  return tx;
}
// a 1→1 send-all of a stored split-child (parentDegree) → a TRANSFER-note @ vout0, retargeting the owner to `out.owner`.
function transferChildTx(parentTxid, parentVout, parentDegree, out, changeValue = 9000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxid, parentVout, 0xffffffff);
  tx.addOutput(ownSPK, out.value); tx.addOutput(stateScript(out.amount, out.owner, out.ownerType), 0); tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: parentDegree }, (_, k) => ({ value: 1 + k, amountSer: encodeAmount(1n), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  tx.ins[0].witness = [...transferSendAllV2Witness({ parent, epi, ownSPK, changeValue, out, amountIn: out.amount }), ...TAIL];
  return tx;
}
// a MERGE tx: vin0+vin1 = two TRANSFER-notes @ vout0; out0=merged tokenOut@transferSPK, out1=merged stateOut, out2=change34B.
function mergeTx(in0, in1, mergedAmount, ownerOut, ot = OwnerType.KEY, changeValue = 15000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(in0.txid, in0.vout, 0xffffffff);
  tx.addInput(in1.txid, in1.vout, 0xffffffff);
  tx.addOutput(ownSPK, 40000);
  tx.addOutput(stateScript(mergedAmount, ownerOut, ot), 0);
  tx.addOutput(changeSPK, changeValue);
  const w = Array.from({ length: MERGE_OWNER_OUT_IDX + 1 }, () => Buffer.alloc(1));
  w[MERGE_OWNER_OUT_IDX] = ownerOut;
  tx.ins[0].witness = [...w, ...TAIL];
  return tx;
}
const child = (f, amount) => ({ owner: Buffer.alloc(20, f), value: 30000, amount, ownerType: OwnerType.KEY });

// genesis → split into 2 → normalize EACH child via 1→1 to OWNER_Z ⟹ two transfer-notes @ vout0, same owner (tight-cap mergeable).
function freshMergeable() {
  const ix = new Indexer(deploy);
  const split = splitAMonoTx([child(0xa0, 7_000_000n), child(0xa1, 14_000_000n)]);
  const splitId = internalTxid(split);
  const tA = transferChildTx(splitId, 0, 2, { owner: OWNER_Z, value: 28000, amount: 7_000_000n, ownerType: OwnerType.KEY });
  const tB = transferChildTx(splitId, 2, 2, { owner: OWNER_Z, value: 28000, amount: 14_000_000n, ownerType: OwnerType.KEY });
  ix.applyBlockForward({ height: 1, blockhash: 'b1', prevhash: null, txs: [mint] });
  ix.applyBlockForward({ height: 2, blockhash: 'b2', prevhash: 'b1', txs: [split] });
  ix.applyBlockForward({ height: 3, blockhash: 'b3', prevhash: 'b2', txs: [tA, tB] });
  return { ix, splitId, noteA: { txid: internalTxid(tA), vout: 0 }, noteB: { txid: internalTxid(tB), vout: 0 } };
}

test('MERGE indexer GREEN: two NORMALIZED transfer-notes (same owner, vout0) merge into 1', () => {
  const { ix, noteA, noteB } = freshMergeable();
  assert.equal(ix.liveNotes.size, 2, 'after normalize: 2 transfer-notes');
  for (const n of ix.liveNotes.values()) { assert.equal(n.provenance, 'transfer'); assert.ok(Buffer.from(n.owner).equals(OWNER_Z)); }
  const merge = mergeTx(noteA, noteB, 21_000_000n, OWNER_Z);
  const mergeId = internalTxid(merge);
  const res = ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [merge] });
  assert.equal(ix.liveNotes.size, 1, 'after merge: 1 live note');
  const merged = ix.liveNotes.get(Buffer.concat([mergeId, Buffer.alloc(4)]).toString('hex'));
  assert.ok(merged && merged.amount === 21_000_000n && merged.provenance === 'merge', 'merged note: 21M, provenance=merge');
  assert.ok(Buffer.from(merged.owner).equals(OWNER_Z), 'owner_out == owner_in (OWNER_Z)');
  let live = 0n; for (const n of ix.liveNotes.values()) live += n.amount;
  assert.equal(live + ix.burnedSupply, AMOUNT_0, 'Σ(live)+burned == AMOUNT_0');
  assert.ok(res.events.some((e) => e[0] === EventTypeV2.MERGE), 'a MERGE event was emitted');
});

test('MERGE indexer RED (the GPT-caught over-acceptance): a DIRECT merge of split-children HALTs', () => {
  // split-children are at vout0/vout2, provenance='split', and (here) different owners — NONE of which the tight-cap leaf accepts.
  const ix = new Indexer(deploy);
  const split = splitAMonoTx([child(0xa0, 7_000_000n), child(0xa1, 14_000_000n)]);
  const splitId = internalTxid(split);
  ix.applyBlockForward({ height: 1, blockhash: 'b1', prevhash: null, txs: [mint] });
  ix.applyBlockForward({ height: 2, blockhash: 'b2', prevhash: 'b1', txs: [split] });
  const badMerge = mergeTx({ txid: splitId, vout: 0 }, { txid: splitId, vout: 2 }, 21_000_000n, Buffer.alloc(20, 0xbb));
  assert.throws(() => ix.applyBlockForward({ height: 3, blockhash: 'b3', prevhash: 'b2', txs: [badMerge] }), /tight-cap merge|covenant_escape/);
});

test('MERGE indexer RED inflation: merged amount != vin0+vin1 HALTs (BIND-not-DECLARE)', () => {
  const { ix, noteA, noteB } = freshMergeable();
  const bad = mergeTx(noteA, noteB, 999_000_000n, OWNER_Z);
  assert.throws(() => ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [bad] }), /does not bind|covenant_escape/);
});

test('MERGE indexer RED owner mismatch: owner_out != owner_in HALTs (the leaf welds owner_out to owner_in)', () => {
  const { ix, noteA, noteB } = freshMergeable();
  const bad = mergeTx(noteA, noteB, 21_000_000n, Buffer.alloc(20, 0xcc));        // owner_out != OWNER_Z
  assert.throws(() => ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [bad] }), /does not bind|covenant_escape/);
});

test('MERGE indexer: determinism — reindex twice gives the identical root + note-set digest', () => {
  const a = freshMergeable(), b = freshMergeable();
  const merge = mergeTx(a.noteA, a.noteB, 21_000_000n, OWNER_Z);
  const r1 = a.ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [merge] });
  const r2 = b.ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [merge] });
  assert.deepEqual(r1.root, r2.root);
  assert.deepEqual(a.ix.noteSetDigest(), b.ix.noteSetDigest());
});

test('MERGE indexer reorg: a merge rolls back atomically (both inputs un-spent, merged note purged)', () => {
  const { ix, noteA, noteB } = freshMergeable();
  const merge = mergeTx(noteA, noteB, 21_000_000n, OWNER_Z);
  ix.applyBlockForward({ height: 4, blockhash: 'b4', prevhash: 'b3', txs: [merge] });
  assert.equal(ix.liveNotes.size, 1);
  ix.rollbackTo(3);
  assert.equal(ix.liveNotes.size, 2, 'after rollback: the 2 transfer-notes are un-spent, the merged note purged');
  let live = 0n; for (const n of ix.liveNotes.values()) live += n.amount;
  assert.equal(live, AMOUNT_0, 'conservation holds after rollback');
});
