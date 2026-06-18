// P4c + P4d + P4e GATE — reorg safety (rollback + re-apply, same-outpoint purge, REORG_HORIZON HALT), the replay invariant,
// and the V1/V2 byte-agreement. No regtest node. Run: node --test native/p4/reorg.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenantRaw } from '../../canaries/tap.mjs';
import { u64, varslice } from '../sighashParts.mjs';
import { encodeState, tokenId } from '../wire.mjs';
import { buildP1e3FullScript } from '../p1e3Covenant.mjs';
import { buildDeploy } from './deploy.mjs';
import { internalTxid } from './predicates.mjs';
import { Indexer, indexChain } from './indexer.mjs';
import { replayInvariant } from './replay.mjs';
import { crossValidate, attestations } from './supervisor.mjs';

const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);
const D = B(0x00);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const stateScript = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);

const gTxid = S(B(0x99));
const G = tokenId({ genesisTxidInternal: gTxid, genesisVout: 0 });
const AMOUNT_0 = 21_000_000n, VALUE_0 = 100000n, F = 50000n, OWNER_0 = Buffer.alloc(20, 0xab);
const feeOut = Buffer.concat([u64(F), varslice(p2wpkh(0xe1))]);
const deploy = buildDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 });
const cov = makeCovenantRaw(buildP1e3FullScript(deploy.consts));
const transferSPK = deploy.transferSPK;

function mintTx() {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x11)), 0, 0xffffffff); tx.addInput(gTxid, 0, 0xffffffff);
  tx.addOutput(transferSPK, Number(VALUE_0)); tx.addOutput(stateScript(G, AMOUNT_0, OWNER_0), 0);
  tx.addOutput(p2wpkh(0xe1), Number(F)); tx.addOutput(p2tr(0x44), 12345);
  return tx;
}
function transferTx(parentTxidInternal, newOwner, value0 = 80000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxidInternal, 0, 0xffffffff);
  tx.addOutput(transferSPK, value0); tx.addOutput(stateScript(G, AMOUNT_0, newOwner), 0); tx.addOutput(p2tr(0x33), 9000);
  const wit = Array.from({ length: 16 }, () => D); wit[10] = newOwner;
  tx.ins[0].witness = [...wit, cov.leaf, cov.controlBlock];
  return tx;
}
const ownerA = Buffer.alloc(20, 0xa0), ownerB = Buffer.alloc(20, 0xb0);

test('P4c REORG: a competing block at h2 rolls back the old branch and re-applies — state == reindex of the new branch', () => {
  const mint = mintTx(), mid = internalTxid(mint);
  const t1 = transferTx(mid, Buffer.alloc(20, 0x11)), t1id = internalTxid(t1);
  const t2A = transferTx(t1id, ownerA), t2B = transferTx(t1id, ownerB);
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [t1] });
  ix.processBlock({ height: 2, blockhash: 'h2A', prevhash: 'h1', txs: [t2A] });
  // --- REORG: t2B replaces t2A (both build on h1) ---
  ix.processBlock({ height: 2, blockhash: 'h2B', prevhash: 'h1', txs: [t2B] });

  const ref = indexChain(deploy, [
    { height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] },
    { height: 1, blockhash: 'h1', prevhash: 'hG', txs: [t1] },
    { height: 2, blockhash: 'h2B', prevhash: 'h1', txs: [t2B] },
  ]);
  assert.ok(ix.root.equals(ref.root), 'post-reorg root must equal reindex-from-genesis of the new branch');
  assert.ok(ix.noteSetDigest().equals(ref.noteSetDigest()), 'post-reorg note set must match');
  assert.equal(ix.liveNotes.size, 1, 'one live note');
  const note = [...ix.liveNotes.values()][0];
  assert.ok(note.owner.equals(ownerB), 'the surviving note is owned by the NEW branch recipient (t2A purged)');
});

test('P4c same-outpoint purge: the rolled-back branch-A note is fully GONE after the reorg (no stale lingering)', () => {
  const mint = mintTx(), mid = internalTxid(mint);
  const t1 = transferTx(mid, Buffer.alloc(20, 0x11)), t1id = internalTxid(t1);
  const t2A = transferTx(t1id, ownerA), t2B = transferTx(t1id, ownerB);
  const t2Aid = internalTxid(t2A).toString('hex');
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [t1] });
  ix.processBlock({ height: 2, blockhash: 'h2A', prevhash: 'h1', txs: [t2A] });
  ix.processBlock({ height: 2, blockhash: 'h2B', prevhash: 'h1', txs: [t2B] });
  for (const k of ix.liveNotes.keys()) assert.ok(!k.startsWith(t2Aid), 'no branch-A note outpoint may survive the reorg');
});

test('P4c REORG_HORIZON: a reorg deeper than the horizon HALTs (forced full reindex, never silently wrong)', () => {
  const mint = mintTx(), mid = internalTxid(mint);
  const t1 = transferTx(mid, Buffer.alloc(20, 0x11)), t1id = internalTxid(t1);
  const t2 = transferTx(t1id, ownerA);
  const ix = new Indexer(deploy, { reorgHorizon: 1 });
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [t1] });
  ix.processBlock({ height: 2, blockhash: 'h2', prevhash: 'h1', txs: [t2] });
  // a competing chain forking at h0 (genesis) = depth 2 > horizon 1 -> HALT
  const t1b = transferTx(mid, Buffer.alloc(20, 0xcc));
  assert.throws(() => ix.processBlock({ height: 1, blockhash: 'h1b', prevhash: 'hG', txs: [t1b] }), /HALT: reorg depth 2 > REORG_HORIZON 1/);
});

test('P4e replay invariant: Σ(live) == AMOUNT_0 and mintCount == 1', () => {
  const mint = mintTx(), mid = internalTxid(mint);
  const t1 = transferTx(mid, ownerA);
  const ix = indexChain(deploy, [
    { height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] },
    { height: 1, blockhash: 'h1', prevhash: 'hG', txs: [t1] },
  ]);
  const r = replayInvariant(ix);
  assert.equal(r.sigma, AMOUNT_0); assert.equal(r.mintCount, 1);
  // an indexer that lost the genesis mint must HALT
  const empty = new Indexer(deploy);
  assert.throws(() => replayInvariant(empty), /HALT replay invariant/);
});

test('P4d 2nd validator: V1 (incremental) and V2 (reindex) byte-agree; attestations are revocable + gated by CONFIRM_DEPTH', () => {
  const mint = mintTx(), mid = internalTxid(mint);
  const blocks = [
    { height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] },
    { height: 1, blockhash: 'h1', prevhash: 'hG', txs: [transferTx(mid, ownerA)] },
  ];
  const v1 = indexChain(deploy, blocks);
  assert.deepEqual(crossValidate(v1, deploy, blocks).agreed, true, 'V1/V2 must byte-agree');
  // CONFIRM_DEPTH=144: a 2-block chain has nothing buried deep enough -> no attestation yet
  assert.equal(attestations(v1).length, 0, 'nothing attestable below CONFIRM_DEPTH');
  // with a small confirmDepth override, the genesis block (buried 1 below tip) becomes attestable + carries the finality caveat
  const att = attestations(v1, { confirmDepth: 1 });
  assert.equal(att.length, 1); assert.equal(att[0].height, 0); assert.match(att[0].finalUnder, /reorg/);
});
