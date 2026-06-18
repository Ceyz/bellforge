// MERGE bricks 3/4 — the merge-parent reconstruction (reachability core): (1) MEASURE the 2-input/3-output byte layout against a
// real belcoinjs tx (never hand-guessed); (2) the kernel reconstructs it byte-exact + parks the merged note's (amount,owner,owner_type)
// + RED a forged field rejects. This is the routine a split/1→1 leaf uses to spend a MERGED note (depth-1) or a note whose grandparent
// was a merge (depth-2 gp='merge').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 as u64s } from './sighashParts.mjs';
import { transferGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { mergeParentTxBytes, mergeParentV2Witness, mergeParentReconstructV2Ops, mergeSpendVia1to1Ops, mergeSpendVia1to1Witness, transferMergeGrandparentV2Ops, transferMergeGrandparentV2Witness, mergeSpendViaSplitOps, mergeSpendViaSplitWitness, splitMergeGrandparentV2Ops, splitMergeGrandparentV2Witness } from './p1e3MergeLineageV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const p2tr = (f) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, f)]);

const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId, ownSPK, changeSPK };
const owner0 = H160(Buffer.alloc(32, 0x0b));
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId, amount: BigInt(amount), owner }))]);

const txid0 = S(B(0x01)), txid1 = S(B(0x02));
const vin0Outpoint = Buffer.concat([txid0, Buffer.alloc(4)]);   // vout 0
const vin1Outpoint = Buffer.concat([txid1, Buffer.alloc(4)]);
const value0 = 40000, amount0 = 21_000_000n, changeVal = 15000;
const fields = { tokenId, ownSPK, changeSPK, vin0Outpoint, vin1Outpoint, value0, amount0, owner0, ownerType0: OwnerType.KEY, changeVal };

test('merge-parent CONST: the assembly matches a real belcoinjs 2-input/3-output serialization', () => {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(txid0, 0, 0xffffffff);
  tx.addInput(txid1, 0, 0xffffffff);
  tx.addOutput(ownSPK, value0);
  tx.addOutput(stateScript(amount0, owner0, OwnerType.KEY), 0);
  tx.addOutput(changeSPK, changeVal);
  const real = tx.toBuffer();
  const mine = mergeParentTxBytes(fields);
  assert.ok(real.equals(mine), `merge-parent byte assembly (${mine.length}B) must equal the real serialization (${real.length}B)`);
});

test('merge-parent KERNEL: reconstructs byte-exact + parks (amount,owner,owner_type) of the merged note', () => {
  const committedTxidP = hash256(mergeParentTxBytes(fields));
  const witness = mergeParentV2Witness({ committedTxidP, vin0Outpoint, vin1Outpoint, changeVal, value0, amount0, owner0, ownerType0: OwnerType.KEY });
  const { ops, W } = mergeParentReconstructV2Ops(consts);
  assert.equal(W, witness.length);
  const r = runScript(ops, witness, null);                       // no terminal OP_1 ⟹ ok=false; check the parked top-3
  const top = r.main.slice(-3);
  assert.ok(top[0].equals(B(OwnerType.KEY)), 'parked owner_type_in == KEY');
  assert.ok(top[1].equals(owner0), 'parked owner_in == owner0');
  assert.ok(top[2].equals(u64(amount0)), 'parked amount_in == amount0');
});

test('merge-parent KERNEL RED: a forged vin0 (≠ committedTxidP source) rejects at the hash EQUALVERIFY', () => {
  const committedTxidP = hash256(mergeParentTxBytes(fields));   // committed to the REAL vin0
  const witness = mergeParentV2Witness({ committedTxidP, vin0Outpoint: Buffer.concat([S(B(0x99)), Buffer.alloc(4)]), vin1Outpoint, changeVal, value0, amount0, owner0, ownerType0: OwnerType.KEY });
  const { ops } = mergeParentReconstructV2Ops(consts);
  let threw = false, ok = null;
  try { ok = runScript(ops, witness, null).ok; } catch { threw = true; }
  assert.ok(threw || ok === false, 'a forged vin0 reconstructs a different tx ⟹ hash256 ≠ committedTxidP ⟹ reject');
});

// ---- CASE (A): a MERGED note is spendable via 1→1 send-all (end-to-end reachability). ----
const leafHash = Buffer.alloc(32, 0x5a);
test('CASE A: a MERGED note is spendable via 1→1 (immediate parent = merge, depth-2 gp = merge.vin0 source)', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), mergedOwner = H160(P);
  // the grandparent = the merge's vin0 SOURCE = a 1→1 transfer (the parent of merged input 0).
  const tailGP = Buffer.concat([u64s(8000), B(0x22), changeSPK, Buffer.alloc(4)]);
  const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(0x55)), Buffer.alloc(4)]), valGP: 50000, ownerGP: mergedOwner, amtGP: 14_000_000n, ownerTypeGP: OwnerType.KEY, tailGP };
  const mergeVin0 = Buffer.concat([hash256(transferGrandparentV2(gpArgs).txGP), Buffer.alloc(4)]);  // (txGP_txid, 0)
  // the merge tx: vin0 = the grandparent's note, vin1 = arbitrary; produces the merged note @ vout0 (amount = 21M, owner = mergedOwner).
  const mergeFields = { tokenId, ownSPK, changeSPK, vin0Outpoint: mergeVin0, vin1Outpoint: Buffer.concat([S(B(0x66)), Buffer.alloc(4)]), value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY, changeVal: 9000 };
  const mergeTxid = hash256(mergeParentTxBytes(mergeFields));
  const mergeParent = { committedTxidP: mergeTxid, vin0Outpoint: mergeVin0, vin1Outpoint: mergeFields.vin1Outpoint, changeVal: 9000, value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY };
  // the 1→1 spend (1-input: the merged note @ (mergeTxid, 0)); send-all preserves the amount.
  const amountIn = 21_000_000n, out = { owner: mergedOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: changeSPK }];
  const inputs = [{ txid: Buffer.from(mergeTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = mergeSpendVia1to1Witness({ mergeParent, gpArgs, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn });
  const r = runScript(mergeSpendVia1to1Ops(consts).ops, witness, sighash);
  assert.equal(r.ok, true, 'a merged note spends via 1→1 with a proven merge-parent + grandparent lineage');
  assert.ok(r.peakStack > 0 && r.peakStack < 1000, `case-A peak ${r.peakStack} < 1000`);
});

test('CASE A RED: a wrong grandparent (≠ merge.vin0 source) rejects (lineage of the merge parent enforced)', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), mergedOwner = H160(P);
  const tailGP = Buffer.concat([u64s(8000), B(0x22), changeSPK, Buffer.alloc(4)]);
  const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(0x55)), Buffer.alloc(4)]), valGP: 50000, ownerGP: mergedOwner, amtGP: 14_000_000n, ownerTypeGP: OwnerType.KEY, tailGP };
  const mergeVin0 = Buffer.concat([hash256(transferGrandparentV2(gpArgs).txGP), Buffer.alloc(4)]);
  const mergeFields = { tokenId, ownSPK, changeSPK, vin0Outpoint: mergeVin0, vin1Outpoint: Buffer.concat([S(B(0x66)), Buffer.alloc(4)]), value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY, changeVal: 9000 };
  const mergeTxid = hash256(mergeParentTxBytes(mergeFields));
  const mergeParent = { committedTxidP: mergeTxid, vin0Outpoint: mergeVin0, vin1Outpoint: mergeFields.vin1Outpoint, changeVal: 9000, value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY };
  const amountIn = 21_000_000n, out = { owner: mergedOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: changeSPK }];
  const inputs = [{ txid: Buffer.from(mergeTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const badGp = { ...gpArgs, amtGP: 99_000_000n };                                  // a different txGP ⟹ hash256(txGP) ≠ merge.vin0
  const witness = mergeSpendVia1to1Witness({ mergeParent, gpArgs: badGp, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn });
  let threw = false, ok = null;
  try { ok = runScript(mergeSpendVia1to1Ops(consts).ops, witness, sighash).ok; } catch { threw = true; }
  assert.ok(threw || ok === false, 'a fabricated grandparent for the merge parent rejects');
});

// ---- CASE (B): spend a note whose GRANDPARENT was a merge (the gp='merge' prefix). ----
function caseBChain(nOwner) {
  // grandparent = a MERGE tx; its note @ vout0 is consumed by txP (a 1→1) which creates note N.
  const mergeGp = { vinGP0: Buffer.concat([S(B(0x71)), Buffer.alloc(4)]), vinGP1: Buffer.concat([S(B(0x72)), Buffer.alloc(4)]), changeValGP: 9000, valueGP0: 50000, amtGP0: 21_000_000n, ownerGP0: H160(Buffer.alloc(32, 0x33)), ownerTypeGP0: OwnerType.KEY };
  const mergeTxid = hash256(mergeParentTxBytes({ tokenId, ownSPK, changeSPK, vin0Outpoint: mergeGp.vinGP0, vin1Outpoint: mergeGp.vinGP1, value0: mergeGp.valueGP0, amount0: mergeGp.amtGP0, owner0: mergeGp.ownerGP0, ownerType0: mergeGp.ownerTypeGP0, changeVal: mergeGp.changeValGP }));
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(mergeTxid, 0, 0xffffffff);                                            // txP consumes the merged note @ vout0
  txP.addOutput(ownSPK, 50000); txP.addOutput(stateScript(21_000_000n, nOwner, OwnerType.KEY), 0); txP.addOutput(changeSPK, 9000);
  const legacyP = txP.toBuffer();
  const parent = { committedTxidP: hash256(legacyP), vin0Outpoint: legacyP.subarray(5, 41), changeVal: 9000, outputs: [{ value: 50000, amountSer: encodeAmount(21_000_000n), owner: nOwner, ownerType: OwnerType.KEY }] };
  return { mergeGp, parent, noteTxid: hash256(legacyP) };
}

test('CASE B: spend a note whose GRANDPARENT was a merge (gp=merge prefix reconstructs the 2-input txGP)', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), nOwner = H160(P);
  const { mergeGp, parent, noteTxid } = caseBChain(nOwner);
  const amountIn = 21_000_000n, out = { owner: nOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: changeSPK }];
  const inputs = [{ txid: Buffer.from(noteTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = transferMergeGrandparentV2Witness({ parent, mergeGp, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn });
  const r = runScript(transferMergeGrandparentV2Ops(1, 0, 8, consts).ops, witness, sighash);
  assert.equal(r.ok, true, 'a note with a merge grandparent spends via 1→1 (gp=merge lineage proven)');
  assert.ok(r.peakStack > 0 && r.peakStack < 1000, `case-B peak ${r.peakStack} < 1000`);
});

test('CASE B RED: a wrong merge grandparent (≠ txP.vin0) rejects', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), nOwner = H160(P);
  const { mergeGp, parent, noteTxid } = caseBChain(nOwner);
  const amountIn = 21_000_000n, out = { owner: nOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: changeSPK }];
  const inputs = [{ txid: Buffer.from(noteTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const badGp = { ...mergeGp, amtGP0: 99_000_000n };                                 // a different merge txGP ⟹ hash256 ≠ txP.vin0
  const witness = transferMergeGrandparentV2Witness({ parent, mergeGp: badGp, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn });
  let threw = false, ok = null;
  try { ok = runScript(transferMergeGrandparentV2Ops(1, 0, 8, consts).ops, witness, sighash).ok; } catch { threw = true; }
  assert.ok(threw || ok === false, 'a fabricated merge-grandparent rejects (gp=merge lineage enforced)');
});

// ---- reachability changeWitness (CORRECTNESS: a real merge uses a witness change ⟹ the reconstruction MUST too). ----
test('CASE A changeWitness: a merge with a WITNESS change (≠ const) is spendable via 1→1', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), mergedOwner = H160(P);
  const mergeChange = p2tr(0x88), curChange = p2tr(0x89);                            // witness-chosen, distinct from the const changeSPK
  const tailGP = Buffer.concat([u64s(8000), B(0x22), changeSPK, Buffer.alloc(4)]);
  const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(0x55)), Buffer.alloc(4)]), valGP: 50000, ownerGP: mergedOwner, amtGP: 14_000_000n, ownerTypeGP: OwnerType.KEY, tailGP };
  const mergeVin0 = Buffer.concat([hash256(transferGrandparentV2(gpArgs).txGP), Buffer.alloc(4)]);
  const mergeFields = { tokenId, ownSPK, changeSPK: mergeChange, vin0Outpoint: mergeVin0, vin1Outpoint: Buffer.concat([S(B(0x66)), Buffer.alloc(4)]), value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY, changeVal: 9000 };
  const mergeTxid = hash256(mergeParentTxBytes(mergeFields));
  const mergeParent = { committedTxidP: mergeTxid, vin0Outpoint: mergeVin0, vin1Outpoint: mergeFields.vin1Outpoint, changeVal: 9000, value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY };
  const amountIn = 21_000_000n, out = { owner: mergedOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: curChange }];
  const inputs = [{ txid: Buffer.from(mergeTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = mergeSpendVia1to1Witness({ mergeParent, gpArgs, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn, cw: { curChangeSpk: curChange, parChangeSpk: mergeChange } });
  const r = runScript(mergeSpendVia1to1Ops({ ...consts, changeWitness: true }).ops, witness, sighash);
  assert.equal(r.ok, true, 'a witness-change merge is spendable (reachability CW correctness)');
});

test('CASE B changeWitness: a note whose merge-grandparent used a WITNESS change is spendable', () => {
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), nOwner = H160(P);
  const mergeChange = p2tr(0x88), parChange = p2tr(0x8a), curChange = p2tr(0x89);    // gp-merge change, txP change, current change (all witness, distinct)
  const mergeGp = { vinGP0: Buffer.concat([S(B(0x71)), Buffer.alloc(4)]), vinGP1: Buffer.concat([S(B(0x72)), Buffer.alloc(4)]), changeValGP: 9000, valueGP0: 50000, amtGP0: 21_000_000n, ownerGP0: H160(Buffer.alloc(32, 0x33)), ownerTypeGP0: OwnerType.KEY, changeSpkGP: mergeChange };
  const mergeTxid = hash256(mergeParentTxBytes({ tokenId, ownSPK, changeSPK: mergeChange, vin0Outpoint: mergeGp.vinGP0, vin1Outpoint: mergeGp.vinGP1, value0: mergeGp.valueGP0, amount0: mergeGp.amtGP0, owner0: mergeGp.ownerGP0, ownerType0: mergeGp.ownerTypeGP0, changeVal: mergeGp.changeValGP }));
  const txP = new bells.Transaction(); txP.version = 2; txP.addInput(mergeTxid, 0, 0xffffffff);
  txP.addOutput(ownSPK, 50000); txP.addOutput(stateScript(21_000_000n, nOwner, OwnerType.KEY), 0); txP.addOutput(parChange, 9000);
  const legacyP = txP.toBuffer();
  const parent = { committedTxidP: hash256(legacyP), vin0Outpoint: legacyP.subarray(5, 41), changeVal: 9000, outputs: [{ value: 50000, amountSer: encodeAmount(21_000_000n), owner: nOwner, ownerType: OwnerType.KEY }] };
  const amountIn = 21_000_000n, out = { owner: nOwner, value: 40000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(amountIn, out.owner, out.ownerType) }, { value: 15000, script: curChange }];
  const inputs = [{ txid: Buffer.from(hash256(legacyP)).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = transferMergeGrandparentV2Witness({ parent, mergeGp, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, out, amountIn, cw: { curChangeSpk: curChange, parChangeSpk: parChange } });
  const r = runScript(transferMergeGrandparentV2Ops(1, 0, 8, { ...consts, changeWitness: true }).ops, witness, sighash);
  assert.equal(r.ok, true, 'a note with a witness-change merge grandparent is spendable (reachability CW correctness)');
});

// ---- the SPLIT variants (validate the offsets before they enter the freeze enumeration). ----
test('CASE A via SPLIT: a merged note spends → M children (offsets validated)', () => {
  const cwConsts = { ...consts, changeWitness: true };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), mergedOwner = H160(P);
  const mergeChange = p2tr(0x88), curChange = p2tr(0x89);
  const tailGP = Buffer.concat([u64s(8000), B(0x22), changeSPK, Buffer.alloc(4)]);
  const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(0x55)), Buffer.alloc(4)]), valGP: 50000, ownerGP: mergedOwner, amtGP: 14_000_000n, ownerTypeGP: OwnerType.KEY, tailGP };
  const mergeVin0 = Buffer.concat([hash256(transferGrandparentV2(gpArgs).txGP), Buffer.alloc(4)]);
  const mergeFields = { tokenId, ownSPK, changeSPK: mergeChange, vin0Outpoint: mergeVin0, vin1Outpoint: Buffer.concat([S(B(0x66)), Buffer.alloc(4)]), value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY, changeVal: 9000 };
  const mergeTxid = hash256(mergeParentTxBytes(mergeFields));
  const mergeParent = { committedTxidP: mergeTxid, vin0Outpoint: mergeVin0, vin1Outpoint: mergeFields.vin1Outpoint, changeVal: 9000, value0: 50000, amount0: 21_000_000n, owner0: mergedOwner, ownerType0: OwnerType.KEY };
  const children = [{ owner: mergedOwner, value: 30000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: mergedOwner, value: 30000, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  const outputs = [];
  for (const c of children) { outputs.push({ value: c.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(c.amount, c.owner, c.ownerType) }); }
  outputs.push({ value: 15000, script: curChange });
  const inputs = [{ txid: Buffer.from(mergeTxid).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = mergeSpendViaSplitWitness({ mergeParent, gpArgs, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: children, amountIn: 21_000_000n, cw: { curChangeSpk: curChange, parChangeSpk: mergeChange } });
  const r = runScript(mergeSpendViaSplitOps(2, cwConsts).ops, witness, sighash);
  assert.equal(r.ok, true, 'a merged note splits into M=2 children (case-A-via-split offsets OK)');
});

test('gp=merge into SPLIT: spend a split-child (Mp=2,j=1) whose grandparent was a merge → M children', () => {
  const cwConsts = { ...consts, changeWitness: true };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), nOwner = H160(P);
  const mergeChange = p2tr(0x88), parChange = p2tr(0x8a), curChange = p2tr(0x89);
  const mergeGp = { vinGP0: Buffer.concat([S(B(0x71)), Buffer.alloc(4)]), vinGP1: Buffer.concat([S(B(0x72)), Buffer.alloc(4)]), changeValGP: 9000, valueGP0: 50000, amtGP0: 21_000_000n, ownerGP0: H160(Buffer.alloc(32, 0x33)), ownerTypeGP0: OwnerType.KEY, changeSpkGP: mergeChange };
  const mergeTxid = hash256(mergeParentTxBytes({ tokenId, ownSPK, changeSPK: mergeChange, vin0Outpoint: mergeGp.vinGP0, vin1Outpoint: mergeGp.vinGP1, value0: mergeGp.valueGP0, amount0: mergeGp.amtGP0, owner0: mergeGp.ownerGP0, ownerType0: mergeGp.ownerTypeGP0, changeVal: mergeGp.changeValGP }));
  // txP: a degree-2 split consuming the merged note @ (mergeTxid, 0). N = child j=1 @ vout 2.
  const txPKids = [{ value: 40000, amount: 8_000_000n, owner: H160(Buffer.alloc(32, 0x44)), ownerType: OwnerType.KEY }, { value: 40000, amount: 13_000_000n, owner: nOwner, ownerType: OwnerType.KEY }];
  const txP = new bells.Transaction(); txP.version = 2; txP.addInput(mergeTxid, 0, 0xffffffff);
  for (const c of txPKids) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  txP.addOutput(parChange, 9000);
  const legacyP = txP.toBuffer();
  const parent = { committedTxidP: hash256(legacyP), vin0Outpoint: legacyP.subarray(5, 41), changeVal: 9000, outputs: txPKids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) };
  // spend N (child 1, amount 13M) via split into 2 grandchildren.
  const gks = [{ owner: nOwner, value: 20000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: nOwner, value: 20000, amount: 8_000_000n, ownerType: OwnerType.KEY }];
  const outputs = [];
  for (const c of gks) { outputs.push({ value: c.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(c.amount, c.owner, c.ownerType) }); }
  outputs.push({ value: 15000, script: curChange });
  const inputs = [{ txid: Buffer.from(hash256(legacyP)).reverse().toString('hex'), vout: 2, value: 40000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = splitMergeGrandparentV2Witness({ parent, mergeGp, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: gks, amountIn: 13_000_000n, cw: { curChangeSpk: curChange, parChangeSpk: parChange } });
  const r = runScript(splitMergeGrandparentV2Ops(2, 1, 2, 8, cwConsts).ops, witness, sighash);
  assert.equal(r.ok, true, 'a split-child with a merge grandparent splits into M children (gp=merge-into-split offsets OK)');
});
