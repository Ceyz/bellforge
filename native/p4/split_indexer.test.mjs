// P4 — the SPLIT wired into the main Indexer: mint → split credits the M children BIND, Σ live == AMOUNT_0 (replay invariant),
// and an INVALID split of a known-live note triggers covenant_escape HALT (never leaves a really-spent note live). Pure.
// Run: node --test native/p4/split_indexer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64, varslice } from '../sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from '../wire.mjs';
import { makeCovenantRaw } from '../../canaries/tap.mjs';
import { buildP1e3FullScript } from '../p1e3Covenant.mjs';
import { buildDeploy } from './deploy.mjs';
import { internalTxid } from './predicates.mjs';
import { Indexer } from './indexer.mjs';
import { replayInvariant } from './replay.mjs';

const S = bells.crypto.sha256, enc = bells.script.number.encode, N = 8;
const B = (...x) => Buffer.from(x);
const p2tr = (f) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, f)]);
const p2wpkh = (f) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, f)]);
const stateScript = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);
const limbPairs = (v) => { const w = []; for (let i = 0; i < N; i++) { const b = Number((BigInt(v) >> BigInt(8 * i)) & 0xffn); w.push(enc(b), B(b)); } return w; };

const gTxid = S(B(0x99));
const G = tokenId({ genesisTxidInternal: gTxid, genesisVout: 0 });
const AMOUNT_0 = 21_000_000n, VALUE_0 = 100000n, F = 50000n, OWNER_0 = Buffer.alloc(20, 0xab);
const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
const deploy = buildDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 });
const transferSPK = deploy.transferSPK;
const changeSPK = p2tr(0x77);

function mintTx() {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x11)), 0, 0xffffffff); tx.addInput(gTxid, 0, 0xffffffff);
  tx.addOutput(transferSPK, Number(VALUE_0)); tx.addOutput(stateScript(G, AMOUNT_0, OWNER_0), 0);
  tx.addOutput(feeSPK, Number(F)); tx.addOutput(p2tr(0x44), 12345);
  return tx;
}
// a split spending (parentTxidInternal, vout) into children [{amount, owner, sat}] + change. Witness = splitFullOps ABI.
function splitTx(parentTxidInternal, vout, children, { tamper } = {}) {
  const M = children.length;
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxidInternal, vout, 0xffffffff);
  for (const c of children) { tx.addOutput(transferSPK, c.sat); tx.addOutput(stateScript(G, c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, 9000);
  const pad = (n) => Buffer.alloc(n, 0);
  const w = [pad(20), pad(64), pad(32), pad(9), pad(32), pad(32), pad(5), pad(32), pad(5), pad(36), transferSPK, u64(9000)];
  for (const c of children) w.push(c.owner, u64(c.sat));
  for (let j = 0; j < M; j++) w.push(...limbPairs(tamper && tamper.j === j ? tamper.amount : children[j].amount));
  w.push(...limbPairs(children.reduce((a, c) => a + c.amount, 0n)));
  tx.ins[0].witness = [...w, B(0x51), B(0xc0)];
  return tx;
}

test('P4 split in the Indexer: mint → 2-way split credits both children, Σ live == AMOUNT_0', () => {
  const ix = new Indexer(deploy);
  const mint = mintTx();
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  assert.equal(ix.liveNotes.size, 1, 'genesis note live');
  const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), sat: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), sat: 40000 }];
  const split = splitTx(internalTxid(mint), 0, children);
  ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [split] });
  assert.equal(ix.liveNotes.size, 2, 'the split note is replaced by its 2 children');
  const amts = [...ix.liveNotes.values()].map((n) => n.amount).sort((a, b) => Number(a - b));
  assert.deepEqual(amts, [7_000_000n, 14_000_000n]);
  const r = replayInvariant(ix);
  assert.equal(r.sigma, AMOUNT_0); // Σ live == AMOUNT_0
  assert.equal(r.mintCount, 1);
});

test('P4 split in the Indexer: spending a child note again (split a child) keeps conservation', () => {
  const ix = new Indexer(deploy);
  const mint = mintTx();
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  const split = splitTx(internalTxid(mint), 0, [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), sat: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), sat: 40000 }]);
  ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [split] });
  // re-split child0 (at vout0, amount 7M) into [3M, 4M]
  const split2 = splitTx(internalTxid(split), 0, [{ amount: 3_000_000n, owner: Buffer.alloc(20, 0xc0), sat: 18000 }, { amount: 4_000_000n, owner: Buffer.alloc(20, 0xd0), sat: 18000 }]);
  ix.processBlock({ height: 2, blockhash: 'h2', prevhash: 'h1', txs: [split2] });
  assert.equal(ix.liveNotes.size, 3, '14M + 3M + 4M');
  assert.equal(replayInvariant(ix).sigma, AMOUNT_0);
});

test('P4 split covenant_escape: an INVALID split (Σ children ≠ spent) of a known-live note HALTs (never silently left live)', () => {
  const ix = new Indexer(deploy);
  const mint = mintTx();
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  // a split whose witness amounts sum to 21M+1 (the on-chain covenant would reject this, so P4 seeing it = a contradiction)
  const bad = splitTx(internalTxid(mint), 0, [{ amount: 7_000_001n, owner: Buffer.alloc(20, 0xa0), sat: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), sat: 40000 }]);
  assert.throws(() => ix.processBlock({ height: 1, blockhash: 'h1', prevhash: 'hG', txs: [bad] }), /HALT covenant_escape/);
});

test('P4 split reorg: a split rolls back fully (all M children purged, the spent note restored)', () => {
  const ix = new Indexer(deploy);
  const mint = mintTx();
  ix.processBlock({ height: 0, blockhash: 'hG', prevhash: 'h_', txs: [mint] });
  const splitA = splitTx(internalTxid(mint), 0, [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), sat: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), sat: 40000 }]);
  ix.processBlock({ height: 1, blockhash: 'h1A', prevhash: 'hG', txs: [splitA] });
  // reorg: a competing block at h1 that does NOT split (just leaves the genesis note)
  ix.processBlock({ height: 1, blockhash: 'h1B', prevhash: 'hG', txs: [] });
  assert.equal(ix.liveNotes.size, 1, 'after reorg the split is undone — the genesis note is live again');
  assert.equal([...ix.liveNotes.values()][0].amount, AMOUNT_0);
});
