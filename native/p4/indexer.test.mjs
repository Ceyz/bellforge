// P4a+P4b GATE — index a synthetic chain (genesis -> transfer#1 -> transfer#2) and assert: reindex==live (determinism),
// same-root under shuffled tx order, decoy OP_RETURN in change IGNORED, and a declare-not-bind inflation FULL_IGNOREd.
// No regtest node. Run: node --test native/p4/indexer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenantRaw } from '../../canaries/tap.mjs';
import { u64, varslice } from '../sighashParts.mjs';
import { encodeState, tokenId } from '../wire.mjs';
import { buildP1e3FullScript } from '../p1e3Covenant.mjs';
import { buildDeploy, selfValidateAtGenesis } from './deploy.mjs';
import { internalTxid } from './predicates.mjs';
import { Indexer, indexChain } from './indexer.mjs';

const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);
const D = B(0x00); // witness placeholder
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const stateScript = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);

const gTxid = S(B(0x99));
const G = tokenId({ genesisTxidInternal: gTxid, genesisVout: 0 });
const AMOUNT_0 = 21_000_000n, VALUE_0 = 100000n, F = 50000n;
const OWNER_0 = Buffer.alloc(20, 0xab);
const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
const deploy = buildDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 });
const cov = makeCovenantRaw(buildP1e3FullScript(deploy.consts));
const transferSPK = deploy.transferSPK;

function mintTx() {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x11)), 0, 0xffffffff);          // M
  tx.addInput(gTxid, 0, 0xffffffff);               // G
  tx.addOutput(transferSPK, Number(VALUE_0));
  tx.addOutput(stateScript(G, AMOUNT_0, OWNER_0), 0);
  tx.addOutput(feeSPK, Number(F));
  tx.addOutput(p2tr(0x44), 12345);
  return tx;
}
// a mono-input transfer spending (parentTxidInternal, 0); out1 commits `commitAmount` (default = the conserved amount);
// the spend witness carries out_owner at index 10 (self-sourced by the indexer). `decoyOut2` adds a fake stateOut in change.
function transferTx({ parentTxidInternal, newOwner, commitAmount, value0 = 80000, decoyOut2 = false }) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxidInternal, 0, 0xffffffff);
  tx.addOutput(transferSPK, value0);
  tx.addOutput(stateScript(G, commitAmount, newOwner), 0);
  tx.addOutput(decoyOut2 ? stateScript(G, 999_999_999n, Buffer.alloc(20, 0xee)) : p2tr(0x33), decoyOut2 ? 0 : 9000);
  const wit = Array.from({ length: 16 }, () => D); wit[10] = newOwner; // idx 10 = out_owner
  tx.ins[0].witness = [...wit, cov.leaf, cov.controlBlock];
  return tx;
}
const owner1 = Buffer.alloc(20, 0x11), owner2 = Buffer.alloc(20, 0x22);
function chain() {
  const mint = mintTx(); const mintId = internalTxid(mint);
  const t1 = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 }); const t1Id = internalTxid(t1);
  const t2 = transferTx({ parentTxidInternal: t1Id, newOwner: owner2, commitAmount: AMOUNT_0 });
  return [{ height: 0, txs: [mint] }, { height: 1, txs: [t1] }, { height: 2, txs: [t2] }];
}

test('P4 self-validate: the genesis tx matches the descriptor; a 1-byte-off descriptor HALTs', () => {
  const mint = mintTx();
  selfValidateAtGenesis(deploy, mint); // no throw
  const bad = buildDeploy({ tokenId: G, AMOUNT_0: AMOUNT_0 + 1n, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 });
  assert.throws(() => selfValidateAtGenesis(bad, mint), /HALT/);
});

test('P4 determinism: reindex-from-genesis == live (root + note-set digest), and the ledger is correct', () => {
  const blocks = chain();
  const a = indexChain(deploy, blocks);
  const b = indexChain(deploy, blocks); // independent reindex
  assert.ok(a.root.equals(b.root), 'two reindexes from genesis must produce the byte-identical root');
  assert.ok(a.noteSetDigest().equals(b.noteSetDigest()), 'note-set digests must match');
  assert.equal(a.liveNotes.size, 1, 'exactly one live note (mono-in/mono-out, full amount)');
  const note = [...a.liveNotes.values()][0];
  assert.equal(note.amount, AMOUNT_0, 'amount conserved through the chain (BIND)');
  assert.ok(note.owner.equals(owner2), 'final owner = transfer#2 recipient');
});

test('P4 determinism: same root under SHUFFLED tx order within a block (non-token txs do not affect the root)', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  const t1 = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 });
  const noise1 = new bells.Transaction(); noise1.version = 2; noise1.addInput(S(B(0x01)), 0, 0xffffffff); noise1.addOutput(p2tr(0x01), 1);
  const noise2 = new bells.Transaction(); noise2.version = 2; noise2.addInput(S(B(0x02)), 0, 0xffffffff); noise2.addOutput(p2tr(0x02), 2);
  const r1 = indexChain(deploy, [{ height: 0, txs: [mint] }, { height: 1, txs: [noise1, t1, noise2] }]).root;
  const r2 = indexChain(deploy, [{ height: 0, txs: [mint] }, { height: 1, txs: [noise2, noise1, t1] }]).root;
  assert.ok(r1.equals(r2), 'shuffled block order + interleaved non-token txs must give the identical root');
});

test('P4 decoy: a fake stateOut in the change output (out2) is IGNORED — only out1 is honored', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  const t1 = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0, decoyOut2: true });
  const ix = indexChain(deploy, [{ height: 0, txs: [mint] }, { height: 1, txs: [t1] }]);
  const note = [...ix.liveNotes.values()][0];
  assert.equal(note.amount, AMOUNT_0, 'the decoy 999999999 in out2 must NOT be credited — amount stays the bound AMOUNT_0');
  assert.ok(note.owner.equals(owner1), 'owner from out1/witness, not the decoy');
});

test('P4 declare-not-bind ⟹ covenant_escape HALT: an inflated spend of a KNOWN-LIVE note can never confirm, so seeing it HALTs', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  // out1 commits AMOUNT_0+1; the indexer BINDs amount=AMOUNT_0 -> out1 can't reproduce. Spending a KNOWN-LIVE note this way
  // is rejected by the covenant pre-confirmation, so if P4 ever sees it = an N9/P4 contradiction = HALT (NOT a silent ignore
  // that would leave the spent note live — GPT P4 round-11, the load-bearing fix).
  const bad = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 + 1n });
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, txs: [mint] });
  assert.throws(() => ix.processBlock({ height: 1, txs: [bad] }), /HALT covenant_escape/);
});

test('P4 intra-block create-then-spend (FIXPOINT): same block t1 creates a note + t2 spends it — identical root + note set in BOTH tx orders', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  const t1 = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 }); const t1Id = internalTxid(t1);
  const t2 = transferTx({ parentTxidInternal: t1Id, newOwner: owner2, commitAmount: AMOUNT_0 });
  const fwd = indexChain(deploy, [{ height: 0, txs: [mint] }, { height: 1, txs: [t1, t2] }]);      // natural (consensus) order
  const rev = indexChain(deploy, [{ height: 0, txs: [mint] }, { height: 1, txs: [t2, t1] }]);      // mis-ordered source: spend BEFORE create
  assert.ok(fwd.root.equals(rev.root), 'same-block create-then-spend must fold to the identical root regardless of tx order');
  assert.ok(fwd.noteSetDigest().equals(rev.noteSetDigest()), 'and the identical live-note set (mutation is order-free, not just the root)');
  assert.equal(rev.liveNotes.size, 1);
  assert.ok([...rev.liveNotes.values()][0].owner.equals(owner2), 'one note, owned by t2 recipient, even when t2 precedes t1 in the block');
});

test('P4 lineage: a covenant-SHAPED tx spending an UNKNOWN outpoint (pay-into-the-address, no ancestry) is IGNORED — no credit, no HALT', () => {
  const mint = mintTx();
  // looks exactly like a transfer (out0=covenant, out1=stateOut) but vin0 is a random UTXO, NOT a live note. Mirrors the
  // on-chain depth-2 induction: anyone may pay INTO the covenant address, but with no lineage to genesis it is never credited.
  const stranger = transferTx({ parentTxidInternal: S(B(0xde)), newOwner: owner1, commitAmount: AMOUNT_0 });
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, txs: [mint] });
  const { events } = ix.processBlock({ height: 1, txs: [stranger] });          // must NOT throw (vin0 is not a known-live note)
  assert.equal(events.length, 0, 'an unlineaged covenant-shaped tx emits no event');
  assert.equal(ix.liveNotes.size, 1, 'only the genesis note is live; the stranger output is NOT credited');
  assert.ok([...ix.liveNotes.values()][0].owner.equals(OWNER_0), 'genesis note untouched');
});

test('P4 covenant_escape: a KNOWN-LIVE note spent with an absent/short witness owner (idx 10) HALTs (not left silently live)', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  const t1 = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 });
  t1.ins[0].witness[10] = Buffer.alloc(0);                                     // witness source missing the owner on a real live-note spend
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, txs: [mint] });
  assert.throws(() => ix.processBlock({ height: 1, txs: [t1] }), /HALT covenant_escape/);
});

test('P4 covenant_escape SWEEP (shape backstop): a KNOWN-LIVE note consumed by a tx P4 does NOT recognize as a transfer HALTs', () => {
  const mint = mintTx(); const mintId = internalTxid(mint);
  // spends the genesis note but carries a 4th output -> fails isMonoInputTransferShape (vout!=3). On-chain the covenant
  // enforces the 3-output shape so this can't confirm; the block-level sweep is the backstop if P4's shape predicate ever
  // missed a REAL transfer: a live note consumed on-chain but not removed by P4 = HALT (never silently left live).
  const weird = transferTx({ parentTxidInternal: mintId, newOwner: owner1, commitAmount: AMOUNT_0 });
  weird.addOutput(p2tr(0x77), 1);                                             // now 4 outputs -> not a recognized transfer
  const ix = new Indexer(deploy);
  ix.processBlock({ height: 0, txs: [mint] });
  assert.throws(() => ix.processBlock({ height: 1, txs: [weird] }), /HALT covenant_escape/);
});
