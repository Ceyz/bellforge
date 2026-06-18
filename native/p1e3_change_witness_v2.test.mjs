// P2-0 BRICK 2 — changeSPK as a spender-chosen WITNESS (not a baked const). Proves the decentralization win: a split parent and the
// spend that consumes its child use DIFFERENT change addresses (impossible when changeSPK is a leaf const — every covenant spend's
// sat-change would land on ONE frozen address forever). The CURRENT change is c6-bound (CSFS) and the PARENT change is committedTxidP-
// bound (the kernel reconstruction), so a forged change SPK is rejected. scriptsim with a byte-exact v2 sighash.
// Run: node --test native/p1e3_change_witness_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Ops, splitFullLineageV2Witness, splitFullLineageV2ScriptWitness, withChangeWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';
import { transferSendAllV2Ops, transferSendAllV2Witness } from './p1e3TransferV2.mjs';
import { splitFullLineageSplitGrandparentV2Ops, splitGrandparentSplitV2, splitFullLineageGenesisGrandparentV2Ops, genesisGrandparentV2, transferGenesisGrandparentV2Ops } from './p1e3SplitGrandparentV2.mjs';
import { u64 } from './sighashParts.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11);
const CHANGE_PARENT = p2tr(0x66), CHANGE_SPEND = p2tr(0x77), CONST_PLACEHOLDER = p2tr(0xde); // distinct addresses; the const is IGNORED in CW mode
const consts = { tokenId: G, changeSPK: CONST_PLACEHOLDER, changeWitness: true };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// txP: a v2 split whose change goes to CHANGE_PARENT (the parent spender's choice). child j is KEY-owned.
function buildTxP(Mp, j, amountIn, parentChange = CHANGE_PARENT) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x42)), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(parentChange, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.KEY }];

// spend child j → M children, the spend's change going to `spendChange`; witness carries curChangeSpk + parChangeSpk.
function trySpend({ Mp, j, txp, outs = curOuts, spendChange = CHANGE_SPEND, curWit, parWit }) {
  const amountIn = outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: spendChange });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs, amountIn, N });
  const w = withChangeWitness(base, { curChangeSpk: curWit ?? spendChange, parChangeSpk: parWit ?? CHANGE_PARENT });
  return runScript(splitFullLineageV2Ops(Mp, j, 2, N, consts).ops, w, sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

test('GREEN: parent change (0x66) and spend change (0x77) DIFFER — no baked address (the decentralization win)', () => {
  for (const j of [0, 1]) assert.ok(trySpend({ Mp: 2, j, txp: buildTxP(2, j, 14_000_000n) }).ok, `distinct change j=${j}`);
});

test('GREEN: the spender can also pick a THIRD change address per spend', () => {
  assert.ok(trySpend({ Mp: 2, j: 0, txp: buildTxP(2, 0, 14_000_000n), spendChange: p2tr(0x55) }).ok, 'a per-spend change address');
});

test('RED parent change forge: a witness parChangeSpk != the real parent change breaks committedTxidP', () => {
  assert.ok(rejects({ Mp: 2, j: 0, txp: buildTxP(2, 0, 14_000_000n), parWit: p2tr(0xee) }), 'wrong parent change rejects (txid mismatch)');
});

test('RED current change forge: a witness curChangeSpk != the tx change output breaks c6 (CSFS)', () => {
  assert.ok(rejects({ Mp: 2, j: 0, txp: buildTxP(2, 0, 14_000_000n), curWit: p2tr(0xee) }), 'witness current change != real change output rejects');
});

test('RED change==ownSPK: a spend whose change goes to the covenant SPK rejects (unbound (M+1)-th note)', () => {
  assert.ok(rejects({ Mp: 2, j: 0, txp: buildTxP(2, 0, 14_000_000n), spendChange: ownSPK }), 'change==ownSPK rejects');
});

// 1→1 send-all with witness change: spend child j → ONE note, the spend's change to a distinct address.
function try1to1({ Mp, j, txp, out = { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY }, spendChange = CHANGE_SPEND, curWit, parWit }) {
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(21_000_000n, out.owner, out.ownerType) }, { value: changeValue, script: spendChange }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = transferSendAllV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn: 21_000_000n });
  const w = withChangeWitness(base, { curChangeSpk: curWit ?? spendChange, parChangeSpk: parWit ?? CHANGE_PARENT });
  return runScript(transferSendAllV2Ops(Mp, j, N, consts).ops, w, sighash);
}

test('GREEN 1→1: parent change and spend change DIFFER (the 1→1 leaf shares the kernel — parent change witness flows through)', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  assert.ok(try1to1({ Mp: 2, j: 1, txp }).ok, '1→1 send-all with distinct change');
});

test('RED 1→1 parent change forge: a wrong parChangeSpk breaks committedTxidP', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  let ok; try { ok = try1to1({ Mp: 2, j: 1, txp, parWit: p2tr(0xee) }).ok; } catch { ok = false; }
  assert.equal(ok, false, 'wrong parent change rejects');
});

// SCRIPT arm + changeWitness: the combined layout has 4 controller fields THEN 2 change fields above Wtotal (cwBase=Wtotal+4).
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const ctrlSPK = p2tr(0x33), poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
const SCRIPT_OWNER = scriptOwnerDescriptor(ctrlSPK, poolId, stateId);
const ctrlOutpoint = Buffer.concat([Buffer.alloc(32, 0x99), u32le(0)]);
const scriptConsts = { tokenId: G, changeSPK: CONST_PLACEHOLDER, arm: 'script', changeWitness: true };

function buildScriptTxP(Mp, j, amountIn) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? SCRIPT_OWNER : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? OwnerType.SCRIPT : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x42)), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(CHANGE_PARENT, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

test('GREEN SCRIPT + changeWitness: 4 controller fields + 2 change fields above Wtotal compose; distinct change', () => {
  const Mp = 2, j = 1, txp = buildScriptTxP(Mp, j, 14_000_000n);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const noteTxidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const ctrlTxidHex = Buffer.from(Buffer.alloc(32, 0x99)).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: CHANGE_SPEND });                          // distinct from CHANGE_PARENT + the const
  const inputs = [{ txid: noteTxidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }, { txid: ctrlTxidHex, vout: 0, value: 50000, spk: ctrlSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = splitFullLineageV2ScriptWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs: curOuts, amountIn: 14_000_000n, N, script: { outpoint1: ctrlOutpoint, controllerSPK: ctrlSPK, poolId, stateId } });
  const w = withChangeWitness(base, { curChangeSpk: CHANGE_SPEND, parChangeSpk: CHANGE_PARENT });
  assert.ok(runScript(splitFullLineageV2Ops(Mp, j, 2, N, scriptConsts).ops, w, sighash).ok, 'SCRIPT arm + witness change, distinct addresses');
});

// SPLIT grandparent + changeWitness: a depth-2 chain where the GRANDPARENT, PARENT, and SPEND each use a DISTINCT change address.
const CHANGE_GP = p2tr(0x44);
function buildTxPFromGp(Mp, j, amountIn, committedTxidGP, voutInGp, parentChange = CHANGE_PARENT) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidGP, voutInGp, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(parentChange, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

test('GREEN split grandparent + changeWitness: grandparent (0x44), parent (0x66), spend (0x77) — THREE distinct change addresses', () => {
  const Mp_gp = 2, jprime = 1, Mp = 2, j = 0;
  const kidsGp = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: OwnerType.KEY }));
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK: CONST_PLACEHOLDER, gpVin0Outpoint: Buffer.alloc(36, 0x43), jprime, kids: kidsGp, changeValGp: 7000, changeSpkGp: CHANGE_GP });
  const txp = buildTxPFromGp(Mp, j, 14_000_000n, hash256(gp.txGP), 2 * jprime);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: CHANGE_SPEND });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = withChangeWitness(splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: curOuts, amountIn: 14_000_000n, N }), { curChangeSpk: CHANGE_SPEND, parChangeSpk: CHANGE_PARENT });
  const w = [...base, ...gp.pieces];
  assert.ok(runScript(splitFullLineageSplitGrandparentV2Ops(Mp, j, Mp, N, Mp_gp, consts), w, sighash).ok, 'depth-2 lineage, 3 distinct change addresses, all witness');
});

// GENESIS grandparent + changeWitness: the gp change is changeSPKgp (witness in the gp pieces); the leaf adds curChangeSpk/parChangeSpk.
const AMOUNT_0 = 21_000_000n, OWNER_0g = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const genConsts = { tokenId: G, changeSPK: CONST_PLACEHOLDER, changeWitness: true, AMOUNT_0, OWNER_0: OWNER_0g, VALUE_0, feeOut };

test('GREEN genesis grandparent + changeWitness: a split-child (gp=genesis) spent with distinct parent/spend change addresses', () => {
  const Mp = 2, j = 0;
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0: OWNER_0g, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
  const txp = buildTxPFromGp(Mp, j, 14_000_000n, hash256(gp.txGP), 0);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: CHANGE_SPEND });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = withChangeWitness(splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: curOuts, amountIn: 14_000_000n, N }), { curChangeSpk: CHANGE_SPEND, parChangeSpk: CHANGE_PARENT });
  const w = [...base, ...gp.pieces];
  assert.ok(runScript(splitFullLineageGenesisGrandparentV2Ops(Mp, j, 2, N, genConsts), w, sighash).ok, 'genesis-gp split-child with witness change');
});

test('GREEN 1→1 genesis grandparent + changeWitness: a split-child sent 1→1 (gp=genesis) with witness change', () => {
  const Mp = 2, j = 1;
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0: OWNER_0g, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
  const txp = buildTxPFromGp(Mp, j, 21_000_000n, hash256(gp.txGP), 0);
  const out = { owner: Buffer.alloc(20, 0xa0), value: 250000, ownerType: OwnerType.KEY };
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(21_000_000n, out.owner, out.ownerType) }, { value: changeValue, script: CHANGE_SPEND }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const base = withChangeWitness(transferSendAllV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn: 21_000_000n }), { curChangeSpk: CHANGE_SPEND, parChangeSpk: CHANGE_PARENT });
  const w = [...base, ...gp.pieces];
  assert.ok(runScript(transferGenesisGrandparentV2Ops(Mp, j, N, genConsts), w, sighash).ok, '1→1 genesis-gp send-all with witness change');
});

test('leaf size with witness change reported', () => {
  console.log(`  split leaf (changeWitness) M'=2 j=0 M=2: ${bells.script.compile(splitFullLineageV2Ops(2, 0, 2, N, consts).ops).length}B`);
  assert.ok(true);
});
