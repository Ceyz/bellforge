// P4 v2 INDEXER — the TIER-FULL applyTx integration end-to-end. Drives the migrated Indexer (wireVersion='v2') through the full
// proven on-chain lifecycle: mint(v2-66B) → split-a-mono → split-child split → 1→1 send-all → SCRIPT 2-input split → BURN. Asserts
// provenance-keyed dispatch (NEVER tx shape), parentDegree sourced from the STORED note, BURN terminal + Σ(live)+burned==AMOUNT_0,
// the vinCount↔owner_type + unrecognized-shape covenant_escape HALTs, determinism (reindex==reindex), and reorg burn-rollback.
// Run: node --test native/p4/indexer_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, encodeAmount, OwnerType, EventTypeV2 } from '../wire.mjs';
import { u64 } from '../sighashParts.mjs';
import { buildDeployV2 } from './deploy.mjs';
import { internalTxid } from './predicates.mjs';
import { Indexer, indexChain } from './indexer.mjs';
import { replayInvariant } from './replay.mjs';
import { crossValidate } from './supervisor.mjs';
import { monoGenesisTx, splitAMonoV2Witness, transferAMonoV2Witness } from '../p1e3MonoGenesisV2.mjs';
import { splitFullLineageV2Witness, splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from '../p1e3SplitFullLineageV2.mjs';
import { transferSendAllV2Witness } from '../p1e3TransferV2.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const ownSPK = p2tr(0x11), changeSPK = p2tr(0x77), changeSPKgp = p2tr(0x88);
const G = Buffer.alloc(36, 0xab), AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n, OWNER_0 = Buffer.alloc(20, 0x55);
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const deploy = buildDeployV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, transferSPK: ownSPK });
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
const TAIL = [Buffer.alloc(40), Buffer.alloc(33)];                                    // [leaf, controlBlock] (indexer ignores; bottom-relative reads)

// the v2 mint tx (2-input genesis: M @ vin0, G @ vin1; out0=VALUE_0@transferSPK, out1=v2 stateOut0, out2=feeOut, out3=change34B).
const mint = bells.Transaction.fromBuffer(monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp }).tx);
const mintId = internalTxid(mint);                                                   // = the genesis note's txid (genesisTxid)
const genesisRef = { genesisTxid: mintId, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp };

// a split-a-mono spend tx: vin0 = the genesis note (mintId, 0); M children + change. Witness = Wk=4 mono ABI.
function splitAMonoTx(children, changeValue = 15000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(mintId, 0, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  tx.ins[0].witness = [...splitAMonoV2Witness({ genesis: genesisRef, epi, ownSPK, changeValue, outs: children, amountIn: AMOUNT_0, N }), ...TAIL];
  return tx;
}
// a split-child split: vin0 = (parentTxid, parentVout) a stored split note of degree parentDegree → M children. Witness = state-v2 Wk=3+4·M'.
function splitChildTx(parentTxid, parentVout, parentDegree, children, changeValue = 9000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxid, parentVout, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: parentDegree }, (_, k) => ({ value: 1 + k, amountSer: encodeAmount(1n), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  tx.ins[0].witness = [...splitFullLineageV2Witness({ parent, epi, ownSPK, changeValue, outs: children, amountIn: children.reduce((a, c) => a + c.amount, 0n), N }), ...TAIL];
  return tx;
}
// a 1→1 send-all of the genesis note (Wk=4) → ONE note (full amount), retargetable owner_type.
function sendAllMintTx(out, changeValue = 15000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(mintId, 0, 0xffffffff);
  tx.addOutput(ownSPK, out.value); tx.addOutput(stateScript(AMOUNT_0, out.owner, out.ownerType), 0); tx.addOutput(changeSPK, changeValue);
  tx.ins[0].witness = [...transferAMonoV2Witness({ genesis: genesisRef, epi, ownSPK, changeValue, out, amountIn: AMOUNT_0 }), ...TAIL];
  return tx;
}
// a 2-input SCRIPT split: vin0 = a stored SCRIPT note (parentTxid, vout), vin1 = the controller co-spend → M children. Witness =
// the SCRIPT arm (state-v2 Wk=3+4·M' + 4 controller fields ABOVE, which don't shift the bottom-relative child reads).
function splitScriptChildTx(parentTxid, parentVout, parentDegree, children, changeValue = 9000) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxid, parentVout, 0xffffffff);                                    // vin0 = the SCRIPT note
  tx.addInput(Buffer.alloc(32, 0xfe), 0, 0xffffffff);                                 // vin1 = the controller co-spend
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: parentDegree }, (_, k) => ({ value: 1 + k, amountSer: encodeAmount(1n), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  tx.ins[0].witness = [...splitFullLineageV2ScriptWitness({ parent, epi, ownSPK, changeValue, outs: children, amountIn: children.reduce((a, c) => a + c.amount, 0n), N,
    script: { outpoint1: Buffer.concat([Buffer.alloc(32, 0xfe), u32le(0)]), controllerSPK: p2tr(0x33), poolId: Buffer.alloc(32, 0x55), stateId: Buffer.alloc(32, 0x66) } }), ...TAIL];
  tx.ins[1].witness = [Buffer.from([0x01]), Buffer.alloc(33)];                        // toy controller witness
  return tx;
}
// spend a TRANSFER note (provenance='transfer', parentDegree=1; immediate parent = a degree-1 1→1 tx). The witness parent has ONE
// output ⟹ Wk=3+4·1=7 (the transfer-parent base case). dummyParent's CONTENT is irrelevant to the indexer (it reads the bottom-relative
// children only); only outputs.length=1 matters for the Wk offset.
const dummyParent1 = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000, outputs: [{ value: 1, amountSer: encodeAmount(1n), owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY }] };
function sendAllTransferTx(parentTxid, out, changeValue = 15000) {           // 1→1 a transfer note → ONE note (chained send-all)
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxid, 0, 0xffffffff);
  tx.addOutput(ownSPK, out.value); tx.addOutput(stateScript(AMOUNT_0, out.owner, out.ownerType), 0); tx.addOutput(changeSPK, changeValue);
  tx.ins[0].witness = [...transferSendAllV2Witness({ parent: dummyParent1, epi, ownSPK, changeValue, out, amountIn: AMOUNT_0 }), ...TAIL];
  return tx;
}
function splitTransferTx(parentTxid, children, changeValue = 9000) {         // split a transfer note → M children
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(parentTxid, 0, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  tx.ins[0].witness = [...splitFullLineageV2Witness({ parent: dummyParent1, epi, ownSPK, changeValue, outs: children, amountIn: children.reduce((a, c) => a + c.amount, 0n), N }), ...TAIL];
  return tx;
}
const blk = (height, txs, prev) => ({ height, blockhash: 'h' + height, prevhash: prev ?? ('h' + (height - 1)), txs });

test('GREEN lifecycle: mint → split-a-mono (M=3: KEY+SCRIPT+BURN, Σ=AMOUNT_0)', () => {
  const ctrlOwner = scriptOwnerDescriptor(p2tr(0x33), Buffer.alloc(32, 0x55), Buffer.alloc(32, 0x66));
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY },
                { owner: ctrlOwner, value: 1, amount: 10_000_000n, ownerType: OwnerType.SCRIPT },
                { owner: Buffer.alloc(20, 0x00), value: 1, amount: 4_000_000n, ownerType: OwnerType.BURN }];
  const ix = new Indexer(deploy);
  ix.processBlock(blk(0, [mint], 'g'));
  assert.equal(ix.liveNotes.size, 1, 'genesis note live');
  const { events } = ix.processBlock(blk(1, [splitAMonoTx(kids)]));
  assert.equal(ix.liveNotes.size, 2, 'KEY + SCRIPT children live (BURN is NOT live)');
  assert.equal(ix.burnedSupply, 4_000_000n, 'BURN child burned');
  const live = [...ix.liveNotes.values()];
  assert.ok(live.every((n) => n.provenance === 'split' && n.parentDegree === 3), 'children: provenance=split, parentDegree=3');
  assert.ok(live.some((n) => n.ownerType === OwnerType.KEY) && live.some((n) => n.ownerType === OwnerType.SCRIPT), 'owner_types carried');
  const types = events.map((e) => e[0]);
  assert.equal(types.filter((t) => t === EventTypeV2.SPLIT_CHILD).length, 2, 'exactly 2 SPLIT_CHILD events');
  assert.equal(types.filter((t) => t === EventTypeV2.BURN).length, 1, 'exactly 1 BURN event');
  assert.equal(types.filter((t) => t === EventTypeV2.TRANSFER).length, 0, 'a split NEVER emits TRANSFER (the v1 fork bug)');
  // checkSupplyV2 ran inside processBlock (Σ live 17M + burned 4M == 21M); reaching here means it passed.
});

test('GREEN send-all-the-mint-note: KEY→SCRIPT deposit (provenance=transfer, parentDegree=1, full amount)', () => {
  const ix = new Indexer(deploy);
  ix.processBlock(blk(0, [mint], 'g'));
  const { events } = ix.processBlock(blk(1, [sendAllMintTx({ owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.SCRIPT })]));
  assert.equal(ix.liveNotes.size, 1);
  const note = [...ix.liveNotes.values()][0];
  // parentDegree=1: the send-all-mint tx is itself a degree-1 1→1 (voutCount 3), so its OUTPUT note's parent is degree 1 (NOT the
  // genesis). A future spend reads it via Wk=3+4·1=7 (the transfer-parent base case), matching the on-chain Mp=1 split kernel.
  assert.ok(note.amount === AMOUNT_0 && note.ownerType === OwnerType.SCRIPT && note.provenance === 'transfer' && note.parentDegree === 1, 'whole supply deposited key→script');
  assert.equal(events.filter((e) => e[0] === EventTypeV2.TRANSFER).length, 1, 'one TRANSFER event');
});

test('GREEN parentDegree from the STORED note: mint → split-a-mono(M=3) → split a child (reads Wk=3+4·3, NOT splitDegree(tx))', () => {
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY },
                { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 8_000_000n, ownerType: OwnerType.KEY },
                { owner: Buffer.alloc(20, 0xc0), value: 1, amount: 6_000_000n, ownerType: OwnerType.KEY }];
  const ix = new Indexer(deploy);
  ix.processBlock(blk(0, [mint], 'g'));
  const monoTx = splitAMonoTx(kids); ix.processBlock(blk(1, [monoTx]));
  const monoTxid = internalTxid(monoTx);
  // spend child @ vout0 (amount 7M, provenance=split parentDegree=3) into a degree-2 split (M=2 != M'=3).
  const grandKids = [{ owner: Buffer.alloc(20, 0xd0), value: 1, amount: 3_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xe0), value: 1, amount: 4_000_000n, ownerType: OwnerType.SCRIPT }];
  const childSplit = splitChildTx(monoTxid, 0, 3, grandKids);                          // parentDegree=3 (the STORED degree), M=2
  ix.processBlock(blk(2, [childSplit]));
  assert.equal(ix.liveNotes.size, 4, '2 untouched mono children + 2 grandchildren');
  const gk = [...ix.liveNotes.values()].filter((n) => n.parentDegree === 2);
  assert.equal(gk.length, 2, 'grandchildren recorded with parentDegree=2 (their creating split degree)');
  assert.ok(gk.some((n) => n.amount === 3_000_000n) && gk.some((n) => n.amount === 4_000_000n), 'grandchild amounts BIND');
});

test('GREEN intra-block FIXPOINT (v2): same block split-a-mono + child-split fold to the identical root/note-set in BOTH tx orders', () => {
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 9_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 12_000_000n, ownerType: OwnerType.KEY }];
  const monoTx = splitAMonoTx(kids);
  const grand = [{ owner: Buffer.alloc(20, 0xd0), value: 1, amount: 4_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xe0), value: 1, amount: 5_000_000n, ownerType: OwnerType.SCRIPT }];
  const childSplit = splitChildTx(internalTxid(monoTx), 0, 2, grand);                 // spends the 9M KEY child (parentDegree=2) created in the SAME block
  const fwd = indexChain(deploy, [blk(0, [mint], 'g'), blk(1, [monoTx, childSplit])]);          // consensus order: create then spend
  const rev = indexChain(deploy, [blk(0, [mint], 'g'), blk(1, [childSplit, monoTx])]);          // mis-ordered source: spend before create
  assert.ok(fwd.root.equals(rev.root), 'order-free fixpoint: identical root regardless of tx order');
  assert.ok(fwd.noteSetDigest().equals(rev.noteSetDigest()), 'and the identical live-note set (mutation order-free)');
  assert.equal(rev.liveNotes.size, 3, '12M KEY mono-child + 4M KEY + 5M SCRIPT grandchildren');
});

test('GREEN determinism: reindex == reindex (root + owner_type/burned digest) across the full lifecycle', () => {
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0x00), value: 1, amount: 14_000_000n, ownerType: OwnerType.BURN }];
  const blocks = [blk(0, [mint], 'g'), blk(1, [splitAMonoTx(kids)])];
  const a = indexChain(deploy, blocks), b = indexChain(deploy, blocks);
  assert.ok(a.root.equals(b.root), 'byte-identical root');
  assert.ok(a.noteSetDigest().equals(b.noteSetDigest()), 'byte-identical digest (folds owner_type + burnedSupply)');
  assert.equal(a.burnedSupply, 14_000_000n);
});

test('GREEN digest distinguishes owner_type: two live sets differing ONLY in a note ownerType produce different digests', () => {
  const a = new Indexer(deploy); a.processBlock(blk(0, [mint], 'g'));
  a.processBlock(blk(1, [sendAllMintTx({ owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.KEY })]));
  const b = new Indexer(deploy); b.processBlock(blk(0, [mint], 'g'));
  b.processBlock(blk(1, [sendAllMintTx({ owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.SCRIPT })]));
  assert.ok(!a.noteSetDigest().equals(b.noteSetDigest()), 'KEY vs SCRIPT (same outpoint/amount/owner) ⟹ different digest');
});

test('GREEN transfer-note re-spend (the freeze-blocker fix): mint → 1→1 → 1→1 binds (parentDegree=1, Wk=7), NOT a HALT', () => {
  const ix = new Indexer(deploy); ix.processBlock(blk(0, [mint], 'g'));
  const t1 = sendAllMintTx({ owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.KEY }); ix.processBlock(blk(1, [t1]));
  const note1 = [...ix.liveNotes.values()][0];
  assert.ok(note1.provenance === 'transfer' && note1.parentDegree === 1, 'transfer note recorded with parentDegree=1 (its parent is the degree-1 1→1 tx)');
  const t2 = sendAllTransferTx(internalTxid(t1), { owner: Buffer.alloc(20, 0xcf), value: 280000, ownerType: OwnerType.KEY }); // spend the transfer note 1→1 AGAIN
  ix.processBlock(blk(2, [t2]));
  assert.equal(ix.liveNotes.size, 1, 'still one live note (the chained transfer)');
  const note2 = [...ix.liveNotes.values()][0];
  assert.ok(note2.amount === AMOUNT_0 && note2.owner.equals(Buffer.alloc(20, 0xcf)) && note2.parentDegree === 1, 'transfer-of-transfer binds (Wk=7), full amount carried');
});

test('GREEN transfer-note SPLIT: mint → 1→1 → split (the transfer note divides; Wk=7 read)', () => {
  const ix = new Indexer(deploy); ix.processBlock(blk(0, [mint], 'g'));
  const t1 = sendAllMintTx({ owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.KEY }); ix.processBlock(blk(1, [t1]));
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 9_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 12_000_000n, ownerType: OwnerType.KEY }];
  ix.processBlock(blk(2, [splitTransferTx(internalTxid(t1), kids)]));
  assert.equal(ix.liveNotes.size, 2, 'the transfer note split into 2 children');
  assert.equal([...ix.liveNotes.values()].reduce((a, n) => a + n.amount, 0n), AMOUNT_0, 'Σ == AMOUNT_0 (conserved through the transfer-parent base case)');
  assert.ok([...ix.liveNotes.values()].every((n) => n.provenance === 'split' && n.parentDegree === 2), 'children: provenance=split, parentDegree=2 (the split that created them)');
});

test('RED HALT vinCount↔owner_type: a SCRIPT note spent in a 1-input tx HALTs (structurally impossible)', () => {
  // mint → split-a-mono creating a SCRIPT child → try to spend that SCRIPT child in a 1-INPUT split.
  const ctrlOwner = scriptOwnerDescriptor(p2tr(0x33), Buffer.alloc(32, 0x55), Buffer.alloc(32, 0x66));
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: ctrlOwner, value: 1, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];
  const ix = new Indexer(deploy); ix.processBlock(blk(0, [mint], 'g'));
  const monoTx = splitAMonoTx(kids); ix.processBlock(blk(1, [monoTx]));
  const monoTxid = internalTxid(monoTx);
  // the SCRIPT child is @ vout2; spend it 1-input (KEY arm) → [2] ARM GATE: vinCount 1 != owner_type-bound 2.
  const bad = splitChildTx(monoTxid, 2, 2, [{ owner: Buffer.alloc(20, 0xd0), value: 1, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xe0), value: 1, amount: 9_000_000n, ownerType: OwnerType.KEY }]);
  assert.throws(() => ix.processBlock(blk(2, [bad])), /vinCount 1 contradicts owner_type-bound 2/);
});

test('GREEN SCRIPT 2-input split: a controller co-spend splits a SCRIPT note (recognizeScriptSplit credits, fixpoint runs it)', () => {
  const ctrlOwner = scriptOwnerDescriptor(p2tr(0x33), Buffer.alloc(32, 0x55), Buffer.alloc(32, 0x66));
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: ctrlOwner, value: 1, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];
  const ix = new Indexer(deploy); ix.processBlock(blk(0, [mint], 'g'));
  const monoTx = splitAMonoTx(kids); ix.processBlock(blk(1, [monoTx]));
  const monoTxid = internalTxid(monoTx);
  // the SCRIPT child @ vout2 (amount 14M, stored parentDegree=2 = the mono split's degree) split in a 2-INPUT tx → 2 children.
  const grand = [{ owner: ctrlOwner, value: 1, amount: 6_000_000n, ownerType: OwnerType.SCRIPT }, { owner: Buffer.alloc(20, 0xe0), value: 1, amount: 8_000_000n, ownerType: OwnerType.KEY }];
  const { events } = ix.processBlock(blk(2, [splitScriptChildTx(monoTxid, 2, 2, grand)]));
  assert.equal(ix.liveNotes.size, 3, 'KEY mono-child + 2 SCRIPT-split grandchildren (the spent SCRIPT note removed)');
  assert.equal(events.filter((e) => e[0] === EventTypeV2.SPLIT_CHILD).length, 2, '2 SPLIT_CHILD events from the SCRIPT split');
  const live = [...ix.liveNotes.values()];
  assert.ok(!live.some((n) => n.amount === 14_000_000n), 'the spent SCRIPT note (14M) is gone');
  const g6 = live.find((n) => n.amount === 6_000_000n), g8 = live.find((n) => n.amount === 8_000_000n);
  assert.ok(g6 && g6.ownerType === OwnerType.SCRIPT && g6.parentDegree === 2, 'a SCRIPT grandchild (6M) re-emitted, parentDegree=2');
  assert.ok(g8 && g8.ownerType === OwnerType.KEY && g8.parentDegree === 2, 'a KEY grandchild (8M, script→key withdrawal) re-emitted');
  assert.equal(live.reduce((a, n) => a + n.amount, 0n), AMOUNT_0, 'Σ live == AMOUNT_0 (no burn this chain)');
});

test('RED HALT unrecognized shape: a KNOWN-LIVE note consumed by a non-family tx HALTs (never silent skip)', () => {
  const ix = new Indexer(deploy); ix.processBlock(blk(0, [mint], 'g'));
  // spend the genesis note with a 1-input tx whose outputs are NOT a split (2M+1) nor a 1→1 (vout3 covenant/stateOut) shape.
  const weird = new bells.Transaction(); weird.version = 2;
  weird.addInput(mintId, 0, 0xffffffff); weird.addOutput(p2tr(0x12), 50000); weird.addOutput(p2tr(0x13), 40000);
  weird.ins[0].witness = [...TAIL];
  assert.throws(() => ix.processBlock(blk(1, [weird])), /HALT covenant_escape/);
});

test('RED reorg: a burning branch rolled away restores burnedSupply (no permanent supply leak) + conservation holds', () => {
  const kidsBurn = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0x00), value: 1, amount: 14_000_000n, ownerType: OwnerType.BURN }];
  const kidsNoBurn = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  const ix = new Indexer(deploy);
  ix.processBlock(blk(0, [mint], 'g'));
  ix.processBlock(blk(1, [splitAMonoTx(kidsBurn)]));                                   // branch A: burns 14M
  assert.equal(ix.burnedSupply, 14_000_000n);
  ix.processBlock({ height: 1, blockhash: 'h1b', prevhash: 'h0', txs: [splitAMonoTx(kidsNoBurn)] }); // reorg to branch B (no burn)
  assert.equal(ix.burnedSupply, 0n, 'burnedSupply un-burned on the rolled-back branch (no leak)');
  assert.equal(ix.liveNotes.size, 2, 'branch B: 2 live KEY children');
  assert.equal([...ix.liveNotes.values()].reduce((a, n) => a + n.amount, 0n), AMOUNT_0, 'Σ live == AMOUNT_0 (all key, none burned)');
});

test('replayInvariant + crossValidate (2nd-validator) hold for a v2 chain WITH a burn (Σ live + burned == AMOUNT_0)', () => {
  const kids = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0x00), value: 1, amount: 14_000_000n, ownerType: OwnerType.BURN }];
  const blocks = [blk(0, [mint], 'g'), blk(1, [splitAMonoTx(kids)])];
  const v1 = indexChain(deploy, blocks);
  const r = replayInvariant(v1);
  assert.equal(r.sigma, 7_000_000n); assert.equal(r.burned, 14_000_000n);             // live 7M + burned 14M == 21M (NOT Σ-live==AMOUNT_0, which would false-HALT)
  const cv = crossValidate(v1, deploy, blocks);                                        // independent re-derivation must byte-agree (root + digest + burnedSupply)
  assert.ok(cv.agreed && cv.root.equals(v1.root), 'V1/V2 agree on a burning v2 chain');
});

test('2nd-validator: a fresh reindex of branch B agrees byte-for-byte after the reorg above', () => {
  const kidsNoBurn = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  const fresh = indexChain(deploy, [blk(0, [mint], 'g'), { height: 1, blockhash: 'h1b', prevhash: 'h0', txs: [splitAMonoTx(kidsNoBurn)] }]);
  const reorged = new Indexer(deploy);
  reorged.processBlock(blk(0, [mint], 'g'));
  reorged.processBlock(blk(1, [splitAMonoTx([{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 21_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 0n, ownerType: OwnerType.KEY }])]));
  reorged.processBlock({ height: 1, blockhash: 'h1b', prevhash: 'h0', txs: [splitAMonoTx(kidsNoBurn)] });
  assert.ok(fresh.root.equals(reorged.root), 'reorged tip root == fresh reindex of branch B');
  assert.ok(fresh.noteSetDigest().equals(reorged.noteSetDigest()), 'and the digest agrees');
});
