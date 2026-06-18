// P2-MERGE CAPSTONE — the K=2 MERGE leaf at CONSENSUS, real Schnorr through the FROZEN 490-leaf taptree control blocks. The last merge
// item (docs/MERGE_REVIEW_BRIEF.md §5.7, [[merge_k2_design]]): scriptsim + freeze enumeration + the off-chain indexer were all green;
// this proves the merge leaf's own real-Schnorr spends at consensus — EXECUTION + the full REACHABILITY family (case A / case B / SCRIPT arm).
//
// Shared prefix (buildChainToMerge): every post-genesis tx is a REAL covenant spend rooting at genesis (NO OP_TRUE shortcut past the mint):
//   mint → root-split M=2 [C0 14M@0, C1 7M@2] → normalize each child ×2 (1→1 {Mp:2,gp:genesis} then {Mp:1,gp:split-2}) to double-normalized
//   T2_0(14M)/T2_1(7M) → 2-input MERGE {side0@vin0 + side1@vin1} → 21M merged note (+ RED inflation rejected via generateblock).
// Test 1 then proves case A (the merged note is split 21M→[14M,7M] — it is spendable + re-divisible) + case B KEY (a gp=merge child spent 1→1).
// Test 2 proves the gp=merge SCRIPT arm: one split-child is deposited to a no-escape CONTROLLER (key→script), then WITHDRAWN via a 2-input
//   co-spend [SCRIPT note @vin0 (gp=merge SCRIPT arm) + controller @vin1] — the full DeFi composition on a merged-note descendant.
// Run (node up): node --test native/merge_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, encodeAmount, OwnerType, tokenId } from './wire.mjs';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { monoGenesisTx, splitAMonoV2Ops, splitAMonoV2Witness } from './p1e3MonoGenesisV2.mjs';
import { transferSendAllV2Witness } from './p1e3TransferV2.mjs';
import { scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';
import {
  transferGenesisGrandparentV2Ops, transferSplitGrandparentV2Ops, genesisGrandparentV2, splitGrandparentSplitV2,
} from './p1e3SplitGrandparentV2.mjs';
import { mergeK2V2LineageOps, mergeK2V2LineageWitness } from './p1e3MergeK2V2.mjs';
import { mergeSpendViaSplitOps, mergeSpendViaSplitWitness, transferMergeGrandparentV2Ops, transferMergeGrandparentV2Witness } from './p1e3MergeLineageV2.mjs';
import { controllerLeafOps, buildControllerLeaf, controllerGenesisTx, poolIdFromGenesisOutpoint } from './controllerCovenant.mjs';
import { buildTaptree } from './freezeEnumerate.mjs';
import { freezeDeploy } from './p4/deploy.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nMERGE capstone regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const DEFAULT = bells.Transaction.SIGHASH_DEFAULT;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const op = (txidInternal, vout) => Buffer.concat([txidInternal, u32le(vout)]);
const display = (txidInternal) => Buffer.from(txidInternal).reverse().toString('hex');
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const CHANGE_PLACEHOLDER = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32)]); // freezeEnumerate forces this (unused under changeWitness)
const KEY = OwnerType.KEY;

const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);
const changeSPKgp = p2tr(0x88);  // the genesis mint's (operator) change SPK
const CHG = p2tr(0x77);          // a single non-covenant change SPK for every covenant spend in the chain (≠ ownSPK, 34B)
const tailOf = (rec) => Buffer.concat([u64(rec.changeVal), B(0x22), rec.changeSpk, Buffer.alloc(4)]); // changeOut ‖ nLockTime (a 1→1 tail)

// mint a v2 genesis to the FROZEN transferSPK (OP_TRUE-funded mint inputs); return the frozen tree + the live mint note + consts.
async function mintFrozen() {
  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1), OWNER_0 = H160(P);
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const deploy = freezeDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34, arms: ['key', 'script'] });
  const tree = buildTaptree(deploy.consts, { arms: ['key', 'script'] });
  const ownSPK = tree.transferSPK;
  const mgp = await fund(opTrue, 1);
  const changeValGp = mgp.valueSats + gf.valueSats - Number(VALUE_0) - Number(feeVal) - 1000000;
  const { genesisTxid, genesis } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: outpointOf(mgp), changeValGp, changeSPKgp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, changeValGp);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  return { tree, ownSPK, G, OWNER_0, genesisTxid, genesis, priv, P, consts: deploy.consts };
}

// the SHARED PREFIX: build the full tight-cap chain mint → root-split → normalize×2 → 2-input MERGE (RED inflation + GREEN), all real
// Schnorr through the frozen control blocks. Returns the live merged note + the reconstruction records both reachability cases need.
async function buildChainToMerge() {
  const { tree, ownSPK, G, OWNER_0, genesisTxid, genesis, priv, P, consts } = await mintFrozen();
  const cBase = { ...consts, changeSPK: CHANGE_PLACEHOLDER };
  const cKey = { ...cBase, arm: 'key' };
  const find = (pred) => { const l = tree.ordered.find((x) => pred(x.id)); if (!l) throw new Error(`leaf not found: ${JSON.stringify(pred)}`); return l; };
  console.log(`\nMERGE chain — frozen tree ${tree.ordered.length} leaves, depth ${tree.depth}, transferSPK ${ownSPK.toString('hex').slice(0, 12)}…`);

  // STEP 2: root-split M=2 (spend the genesis MINT note → C0 14M@vout0, C1 7M@vout2). leaf {root-split, M:2}.
  const RS = find((id) => id.fam === 'root-split' && id.M === 2);
  assert.ok(bells.script.compile(splitAMonoV2Ops(2, N, cBase).ops).equals(RS.leaf), 'root-split leaf == frozen bytes');
  const cbRS = tree.controlBlockFor(RS.leaf), leafHashRS = tapLeafHash(RS.leaf);
  const kids = [{ value: 350000, amount: 14_000_000n, owner: OWNER_0, ownerType: KEY }, { value: 350000, amount: 7_000_000n, owner: OWNER_0, ownerType: KEY }];
  const txRS = new bells.Transaction(); txRS.version = 2;
  txRS.addInput(genesisTxid, 0, 0xffffffff);
  const outsRS = [];
  for (const c of kids) { outsRS.push({ value: c.value, script: ownSPK }); outsRS.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
  const changeValRS = Number(VALUE_0) - 700000 - 30000;
  outsRS.push({ value: changeValRS, script: CHG });
  for (const o of outsRS) txRS.addOutput(o.script, o.value);
  const legacyRS = txRS.toBuffer(), txidRS = hash256(legacyRS), vin0RS = legacyRS.subarray(5, 41);
  {
    const real = txRS.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], DEFAULT, leafHashRS);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: display(genesisTxid), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outsRS });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: leafHashRS, parts });
    const w = splitAMonoV2Witness({ genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHashRS, c9 }, ownSPK, changeValue: changeValRS, outs: kids, amountIn: AMOUNT_0, N, curChangeSpk: CHG, parChangeSpk: CHG });
    assert.equal(runScript(splitAMonoV2Ops(2, N, cBase).ops, w, real).ok, true, 'root-split scriptsim GREEN');
    txRS.ins[0].witness = [...w, RS.leaf, cbRS];
    await expectAccept(txRS.toHex());
  }
  console.log(`  STEP 2 root-split → C0(14M@0) C1(7M@2)  ${display(txidRS)}`);
  const recRS = { committedTxid: txidRS, vin0Outpoint: vin0RS, changeVal: changeValRS, changeSpk: CHG, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })), kids };

  // a 1→1 send-all transfer with a grandparent arm (steps 3–6). Spends inNote, re-emits its full amount, returns the new record.
  async function transferStep({ label, leaf, opsFn, inNote, parent, gpPieces, outValue, fee }) {
    const cb = tree.controlBlockFor(leaf), leafHash = tapLeafHash(leaf);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(inNote.committedTxid, inNote.vout, 0xffffffff);
    const changeVal = inNote.valueSats - outValue - fee;
    const outs = [{ value: outValue, script: ownSPK }, { value: 0, script: stateScript(G, inNote.amount, OWNER_0, KEY) }, { value: changeVal, script: CHG }];
    for (const o of outs) tx.addOutput(o.script, o.value);
    const legacy = tx.toBuffer(), txid = hash256(legacy), vin0 = legacy.subarray(5, 41);
    const real = tx.hashForWitnessV1(0, [ownSPK], [inNote.valueSats], DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: display(inNote.committedTxid), vout: inNote.vout, value: inNote.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const base = transferSendAllV2Witness({ parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: changeVal, out: { owner: OWNER_0, value: outValue, ownerType: KEY }, amountIn: inNote.amount });
    const full = [...base, CHG /* curChangeSpk */, parent.changeSpk /* parChangeSpk */, ...gpPieces];
    assert.equal(runScript(opsFn(), full, real).ok, true, `${label} scriptsim GREEN`);
    assert.ok(bells.script.compile(opsFn()).equals(leaf), `${label} leaf == frozen bytes`);
    tx.ins[0].witness = [...full, leaf, cb];
    const acc = await expectAccept(tx.toHex());
    assert.ok(acc.confirmations >= 1, `${label} not confirmed`);
    console.log(`  ${label}  ${acc.txid}`);
    return { committedTxid: txid, vin0Outpoint: vin0, valueSats: outValue, amount: inNote.amount, changeVal, changeSpk: CHG };
  }

  const gpGenesisPieces = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: genesis.mintOutpoint, changeSPKgp, changeValueGp: BigInt(genesis.changeValGp) }).pieces;
  const parentMp2 = { committedTxidP: recRS.committedTxid, vin0Outpoint: recRS.vin0Outpoint, changeVal: recRS.changeVal, changeSpk: recRS.changeSpk, outputs: recRS.outputs };

  // STEP 3 & 4: normalize each split-child to a 1→1 transfer note (leaf {1to1, Mp:2, j, gp:genesis}).
  const recT1_0 = await transferStep({ label: 'STEP 3 C0→T1_0 {Mp:2,j:0,gp:genesis}', leaf: find((id) => id.fam === '1to1' && id.Mp === 2 && id.j === 0 && id.gp === 'genesis' && id.arm === 'key').leaf, opsFn: () => transferGenesisGrandparentV2Ops(2, 0, N, cKey), inNote: { committedTxid: txidRS, vout: 0, valueSats: 350000, amount: 14_000_000n }, parent: parentMp2, gpPieces: gpGenesisPieces, outValue: 300000, fee: 30000 });
  const recT1_1 = await transferStep({ label: 'STEP 4 C1→T1_1 {Mp:2,j:1,gp:genesis}', leaf: find((id) => id.fam === '1to1' && id.Mp === 2 && id.j === 1 && id.gp === 'genesis' && id.arm === 'key').leaf, opsFn: () => transferGenesisGrandparentV2Ops(2, 1, N, cKey), inNote: { committedTxid: txidRS, vout: 2, valueSats: 350000, amount: 7_000_000n }, parent: parentMp2, gpPieces: gpGenesisPieces, outValue: 300000, fee: 30000 });

  const splitGpPieces = (jprime) => splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK: CHANGE_PLACEHOLDER, gpVin0Outpoint: recRS.vin0Outpoint, jprime, kids: recRS.kids, changeValGp: recRS.changeVal, changeSpkGp: recRS.changeSpk }).pieces;
  const parentMp1 = (rec) => ({ committedTxidP: rec.committedTxid, vin0Outpoint: rec.vin0Outpoint, changeVal: rec.changeVal, changeSpk: rec.changeSpk, outputs: [{ value: rec.valueSats, amountSer: encodeAmount(rec.amount), owner: OWNER_0, ownerType: KEY }] });
  const SPLIT_GP_LEAF = find((id) => id.fam === '1to1' && id.Mp === 1 && id.j === 0 && id.gp === 'split' && id.Mp_gp === 2 && id.arm === 'key').leaf;

  // STEP 5 & 6: second normalize → double-normalized notes (parent=1→1 ∧ gp=1→1). leaf {1to1, Mp:1, j:0, gp:split-2}.
  const recT2_0 = await transferStep({ label: 'STEP 5 T1_0→T2_0 {Mp:1,gp:split-2,j\'=0}', leaf: SPLIT_GP_LEAF, opsFn: () => transferSplitGrandparentV2Ops(1, 0, N, 2, cKey), inNote: { committedTxid: recT1_0.committedTxid, vout: 0, valueSats: recT1_0.valueSats, amount: 14_000_000n }, parent: parentMp1(recT1_0), gpPieces: splitGpPieces(0), outValue: 250000, fee: 30000 });
  const recT2_1 = await transferStep({ label: 'STEP 6 T1_1→T2_1 {Mp:1,gp:split-2,j\'=1}', leaf: SPLIT_GP_LEAF, opsFn: () => transferSplitGrandparentV2Ops(1, 0, N, 2, cKey), inNote: { committedTxid: recT1_1.committedTxid, vout: 0, valueSats: recT1_1.valueSats, amount: 7_000_000n }, parent: parentMp1(recT1_1), gpPieces: splitGpPieces(1), outValue: 250000, fee: 30000 });

  // STEP 7: the 2-input MERGE. side0 leaf @ vin0, side1 leaf @ vin1; real Schnorr on BOTH owner-key sighashes.
  const M0 = find((id) => id.fam === 'merge' && id.side === 0), M1 = find((id) => id.fam === 'merge' && id.side === 1);
  assert.ok(bells.script.compile(mergeK2V2LineageOps(0, cBase).ops).equals(M0.leaf), 'merge side0 leaf == frozen bytes');
  assert.ok(bells.script.compile(mergeK2V2LineageOps(1, cBase).ops).equals(M1.leaf), 'merge side1 leaf == frozen bytes');
  const cbM0 = tree.controlBlockFor(M0.leaf), cbM1 = tree.controlBlockFor(M1.leaf), leafHashM0 = tapLeafHash(M0.leaf), leafHashM1 = tapLeafHash(M1.leaf);
  const gpOf = (gpRec, amount) => ({ tokenId: G, ownSPK, gpVin0Outpoint: gpRec.vin0Outpoint, valGP: gpRec.valueSats, ownerGP: OWNER_0, amtGP: amount, ownerTypeGP: KEY, tailGP: tailOf(gpRec) });
  const vMerged = 200000, feeM = 50000, changeValM = recT2_0.valueSats + recT2_1.valueSats - vMerged - feeM;

  function buildMerge({ infl = 0n } = {}) {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(recT2_0.committedTxid, 0, 0xffffffff);
    tx.addInput(recT2_1.committedTxid, 0, 0xffffffff);
    const outAmt = AMOUNT_0 + infl;
    const outs = [{ value: vMerged, script: ownSPK }, { value: 0, script: stateScript(G, outAmt, OWNER_0, KEY) }, { value: changeValM, script: CHG }];
    for (const o of outs) tx.addOutput(o.script, o.value);
    const parts = sighashComponents({ inputs: [
      { txid: display(recT2_0.committedTxid), vout: 0, value: recT2_0.valueSats, spk: ownSPK, sequence: 0xffffffff },
      { txid: display(recT2_1.committedTxid), vout: 0, value: recT2_1.valueSats, spk: ownSPK, sequence: 0xffffffff },
    ], outputs: outs });
    const mkSide = (side) => {
      const leaf = side === 0 ? M0.leaf : M1.leaf, leafHash = side === 0 ? leafHashM0 : leafHashM1;
      const real = tx.hashForWitnessV1(side, [ownSPK, ownSPK], [recT2_0.valueSats, recT2_1.valueSats], DEFAULT, leafHash);
      const sig = Buffer.from(ecc.signSchnorr(real, priv));
      const r = reassembleSighash({ inIndex: side, leafHash, parts });
      const self = side === 0 ? recT2_0 : recT2_1, other = side === 0 ? recT2_1 : recT2_0;
      const gpSelfRec = side === 0 ? recT1_0 : recT1_1, gpOtherRec = side === 0 ? recT1_1 : recT1_0;
      const w = mergeK2V2LineageWitness({
        parentSelf: parentMp1(self), parentOther: parentMp1(other),
        epi: { sig, P, c1: r.pre, c3: parts.shaAmounts, c5: parts.shaSequences, c8: leafHash, c9: r.post },
        ownSPK, changeValue: changeValM, ownerOut: OWNER_0, valueOut: vMerged,
        amtSelf: self.amount, amtOther: other.amount, outOverride: infl ? outAmt : undefined,
        gpSelf: gpOf(gpSelfRec, self.amount), gpOther: gpOf(gpOtherRec, other.amount),
        cw: { curChangeSpk: CHG, parSelfChangeSpk: self.changeSpk, parOtherChangeSpk: other.changeSpk },
      });
      return { w, leaf, cb: side === 0 ? cbM0 : cbM1, real, ops: mergeK2V2LineageOps(side, cBase).ops };
    };
    return { tx, sides: [mkSide(0), mkSide(1)] };
  }

  // RED first (inflation): forged amount_out = 21M+1; conservation amt_self+amt_other = 21M != 21M+1 ⟹ reject. UTXOs stay for GREEN.
  const red = buildMerge({ infl: 1n });
  red.tx.ins[0].witness = [...red.sides[0].w, red.sides[0].leaf, red.sides[0].cb];
  red.tx.ins[1].witness = [...red.sides[1].w, red.sides[1].leaf, red.sides[1].cb];
  assert.equal((await notMinable(red.tx.toHex())).mined, false, 'RED merge inflation (amount_out=21M+1) rejected at block-validation');
  console.log('  STEP 7 RED inflation (amount_out=21M+1): rejected at block-validation');

  const grn = buildMerge();
  const txidMerge = hash256(grn.tx.toBuffer());   // capture BEFORE witnesses
  for (const side of grn.sides) assert.equal(runScript(side.ops, side.w, side.real).ok, true, 'merge side scriptsim GREEN');
  assert.equal(grn.sides[0].cb.length, 33 + 32 * tree.depth, 'depth-9 control block (frozen tree)');
  grn.tx.ins[0].witness = [...grn.sides[0].w, grn.sides[0].leaf, grn.sides[0].cb];
  grn.tx.ins[1].witness = [...grn.sides[1].w, grn.sides[1].leaf, grn.sides[1].cb];
  const acc = await expectAccept(grn.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'merge not confirmed');
  console.log(`  STEP 7 GREEN: 2-input MERGE → 21M merged note confirmed ${acc.txid}`);

  // the merge tx as the merged note's parent (case A kernel) + its vin0 source txT2_0 (a 1→1, the gp=transfer arm).
  const mergeParentRec = { committedTxidP: txidMerge, vin0Outpoint: op(recT2_0.committedTxid, 0), vin1Outpoint: op(recT2_1.committedTxid, 0), changeVal: changeValM, value0: vMerged, amount0: AMOUNT_0, owner0: OWNER_0, ownerType0: KEY };
  const mergeGpArgs = gpOf(recT2_0, recT2_0.amount);
  // the gp='merge' grandparent pieces (case B reconstructs the merge tx as the grandparent of a case-A split child).
  const mergeGpPieces = { vinGP0: op(recT2_0.committedTxid, 0), vinGP1: op(recT2_1.committedTxid, 0), changeValGP: changeValM, valueGP0: vMerged, amtGP0: AMOUNT_0, ownerGP0: OWNER_0, ownerTypeGP0: KEY, changeSpkGP: CHG };
  return { tree, ownSPK, G, OWNER_0, priv, P, cBase, cKey, find, txidMerge, vMerged, changeValM, mergeParentRec, mergeGpArgs, mergeGpPieces };
}

// CASE A: split the merged note → children of the given owner_types (one of which may be a SCRIPT deposit). Returns the child records.
async function caseASplit(ctx, { dkids, redInfl = false } = {}) {
  const { tree, ownSPK, G, priv, P, cKey, find, txidMerge, vMerged, mergeParentRec, mergeGpArgs } = ctx;
  const A = find((id) => id.fam === 'split' && id.Mp === 'merge' && id.j === 0 && id.M === 2 && id.gp === 'transfer' && id.arm === 'key');
  assert.ok(bells.script.compile(mergeSpendViaSplitOps(2, cKey).ops).equals(A.leaf), 'case-A split leaf == frozen bytes');
  const cbA = tree.controlBlockFor(A.leaf), leafHashA = tapLeafHash(A.leaf);
  const buildA = ({ infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(txidMerge, 0, 0xffffffff);
    const outs = [];
    dkids.forEach((c, i) => { outs.push({ value: c.value, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, infl && i === 1 ? c.amount + infl : c.amount, c.owner, c.ownerType) }); });
    const changeVal = vMerged - dkids.reduce((a, c) => a + c.value, 0) - 20000; outs.push({ value: changeVal, script: CHG });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const legacy = tx.toBuffer(), txid = hash256(legacy), vin0 = legacy.subarray(5, 41);
    const real = tx.hashForWitnessV1(0, [ownSPK], [vMerged], DEFAULT, leafHashA);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: display(txidMerge), vout: 0, value: vMerged, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: leafHashA, parts });
    const outsW = dkids.map((c, i) => ({ owner: c.owner, value: c.value, amount: infl && i === 1 ? c.amount + infl : c.amount, ownerType: c.ownerType }));
    const w = mergeSpendViaSplitWitness({ mergeParent: mergeParentRec, gpArgs: mergeGpArgs, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHashA, c9 }, ownSPK, changeValue: changeVal, outs: outsW, amountIn: AMOUNT_0, cw: { curChangeSpk: CHG, parChangeSpk: CHG } });
    return { tx, w, txid, vin0, changeVal, real };
  };
  if (redInfl) { const r = buildA({ infl: 1n }); r.tx.ins[0].witness = [...r.w, A.leaf, cbA]; assert.equal((await notMinable(r.tx.toHex())).mined, false, 'RED case-A: inflated split of the merged note rejected'); }
  const g = buildA(); assert.equal(runScript(mergeSpendViaSplitOps(2, cKey).ops, g.w, g.real).ok, true, 'case-A split scriptsim GREEN');
  g.tx.ins[0].witness = [...g.w, A.leaf, cbA];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'case-A split not confirmed');
  const outputs = dkids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType }));
  return { txid: g.txid, vin0: g.vin0, changeVal: g.changeVal, outputs, accTxid: acc.txid };
}

test('MERGE CAPSTONE: 2-input MERGE (real Schnorr, frozen control blocks) + reachability case A (re-split) + case B KEY (gp=merge); RED inflation rejected', { skip }, async () => {
  const ctx = await buildChainToMerge();
  const { tree, ownSPK, G, OWNER_0, priv, P, cKey, find, mergeGpPieces } = ctx;

  // STEP 8 (case A): split the MERGED note 21M → [D0 14M@0, D1 7M@2], both KEY. Proves a merged note is spendable + re-divisible.
  const dkids = [{ value: 60000, amount: 14_000_000n, owner: OWNER_0, ownerType: KEY }, { value: 60000, amount: 7_000_000n, owner: OWNER_0, ownerType: KEY }];
  const splitRec = await caseASplit(ctx, { dkids, redInfl: true });
  console.log(`  STEP 8 GREEN (case A): merged note SPLIT 21M→[14M,7M] ${splitRec.accTxid} — a merged note is spendable + re-divisible`);
  const recD0 = { committedTxid: splitRec.txid, vin0Outpoint: splitRec.vin0, changeVal: splitRec.changeVal, valueSats: 60000, amount: 14_000_000n, outputs: splitRec.outputs };

  // STEP 9 (case B KEY): spend D0 (grandparent = the merge tx) via 1→1. leaf {1to1, Mp:2, j:0, gp:'merge', arm:key}.
  const Bl = find((id) => id.fam === '1to1' && id.Mp === 2 && id.j === 0 && id.gp === 'merge' && id.arm === 'key');
  assert.ok(bells.script.compile(transferMergeGrandparentV2Ops(2, 0, N, cKey).ops).equals(Bl.leaf), 'case-B gp=merge leaf == frozen bytes');
  const cbB = tree.controlBlockFor(Bl.leaf), leafHashB = tapLeafHash(Bl.leaf);
  const buildB = ({ infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(recD0.committedTxid, 0, 0xffffffff);
    const changeVal = recD0.valueSats - 30000 - 20000;
    const outs = [{ value: 30000, script: ownSPK }, { value: 0, script: stateScript(G, recD0.amount + infl, OWNER_0, KEY) }, { value: changeVal, script: CHG }];
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [recD0.valueSats], DEFAULT, leafHashB);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: display(recD0.committedTxid), vout: 0, value: recD0.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: leafHashB, parts });
    const w = transferMergeGrandparentV2Witness({ parent: { committedTxidP: recD0.committedTxid, vin0Outpoint: recD0.vin0Outpoint, changeVal: recD0.changeVal, outputs: recD0.outputs }, mergeGp: mergeGpPieces, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHashB, c9 }, ownSPK, changeValue: changeVal, out: { owner: OWNER_0, value: 30000, ownerType: KEY }, amountIn: recD0.amount + infl, cw: { curChangeSpk: CHG, parChangeSpk: CHG } });
    return { tx, w, real };
  };
  const bRed = buildB({ infl: 1n }); bRed.tx.ins[0].witness = [...bRed.w, Bl.leaf, cbB];
  assert.equal((await notMinable(bRed.tx.toHex())).mined, false, 'RED case-B: inflated re-emit of a gp=merge note rejected at block-validation');
  const bG = buildB(); assert.equal(runScript(transferMergeGrandparentV2Ops(2, 0, N, cKey).ops, bG.w, bG.real).ok, true, 'case-B gp=merge scriptsim GREEN');
  bG.tx.ins[0].witness = [...bG.w, Bl.leaf, cbB];
  const accB = await expectAccept(bG.tx.toHex());
  assert.ok(accB.confirmations >= 1, 'case-B gp=merge not confirmed');
  console.log(`  STEP 9 GREEN (case B KEY): a gp=merge note spent 1→1 ${accB.txid} — depth-2 merge lineage closes`);
  console.log('\n✅ MERGE: execution (both inputs, real Schnorr, frozen control blocks) + reachability case A (re-split) + case B KEY (gp=merge), RED inflation rejected at every step.\n');
});

test('MERGE gp=merge SCRIPT ARM: a merged-note descendant deposited to a no-escape CONTROLLER (key→script) is WITHDRAWN via a 2-input co-spend', { skip }, async () => {
  const ctx = await buildChainToMerge();
  const { tree, ownSPK, G, OWNER_0, priv, P, cBase, find } = ctx;
  const opTrue = makeCovenant([O.OP_TRUE]);

  // ── a no-escape CONTROLLER instance (its own genesis lineage). The SCRIPT note will commit owner = hash160(controllerSPK‖pool_id‖state_id). ──
  const cVAL = 100000n, cFeeVal = 1000n, cFeeOut = Buffer.concat([u64(cFeeVal), B(0x22), feeSPK]), cGenChangeSPK = p2tr(0x55);
  const mF = await fund(opTrue, 1), cgF = await fund(opTrue, 1);
  const minterOutpoint = outpointOf(mF), CG = outpointOf(cgF);
  const ctrlConsts = { CG, minterOutpoint, VALUE_0: cVAL, feeOut: cFeeOut };
  const ctrlCov = makeCovenantRaw(buildControllerLeaf(ctrlConsts)), controllerSPK = ctrlCov.output;
  const poolId = poolIdFromGenesisOutpoint(minterOutpoint), stateId = poolId;
  const cGenChangeVal = mF.valueSats + cgF.valueSats - Number(cVAL) - Number(cFeeVal) - 100000;
  const gC = controllerGenesisTx({ CG, controllerSPK, VALUE_0: cVAL, feeOut: cFeeOut, minterOutpoint, changeVal: cGenChangeVal, changeSPK: cGenChangeSPK });
  const txGc = new bells.Transaction(); txGc.version = 2;
  txGc.addInput(Buffer.from(mF.fundTxid, 'hex').reverse(), mF.vout, 0xffffffff);
  txGc.addInput(Buffer.from(cgF.fundTxid, 'hex').reverse(), cgF.vout, 0xffffffff);
  txGc.addOutput(controllerSPK, Number(cVAL));
  txGc.addOutput(Buffer.concat([B(0x6a, 0x20), gC.stateOut0.subarray(11)]), 0);
  txGc.addOutput(feeSPK, Number(cFeeVal)); txGc.addOutput(cGenChangeSPK, cGenChangeVal);
  assert.ok(txGc.toBuffer().equals(gC.tx), 'controller genesis byte-exact');
  const ctrlCommitted = hash256(txGc.toBuffer());
  txGc.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGc.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGc.toHex());
  const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
  console.log(`  controller instance live (pool_id ${poolId.subarray(0, 6).toString('hex')}…), SCRIPT owner = the no-key descriptor`);

  // STEP 8' (case A, key→script DEPOSIT): split the merged note → D0 14M@0 (KEY) + D1 7M@2 (SCRIPT, owner = controller descriptor).
  const dkids = [{ value: 60000, amount: 14_000_000n, owner: OWNER_0, ownerType: KEY }, { value: 60000, amount: 7_000_000n, owner: SCRIPT_OWNER, ownerType: OwnerType.SCRIPT }];
  const splitRec = await caseASplit(ctx, { dkids });
  console.log(`  STEP 8' GREEN (case A deposit): merged note SPLIT → D0(14M,KEY) + D1(7M,SCRIPT@controller) ${splitRec.accTxid}`);
  const recD1 = { committedTxid: splitRec.txid, vin0Outpoint: splitRec.vin0, changeVal: splitRec.changeVal, valueSats: 60000, amount: 7_000_000n, outputs: splitRec.outputs };

  // STEP 10 (case B SCRIPT arm): WITHDRAW D1 via a 2-input co-spend — [D1 (gp=merge SCRIPT-arm leaf) @vin0, controller @vin1].
  const cScript = { ...cBase, arm: 'script' };
  const Bs = find((id) => id.fam === '1to1' && id.Mp === 2 && id.j === 1 && id.gp === 'merge' && id.arm === 'script');
  assert.ok(bells.script.compile(transferMergeGrandparentV2Ops(2, 1, N, cScript).ops).equals(Bs.leaf), 'SCRIPT-arm gp=merge leaf == frozen bytes');
  const cbBs = tree.controlBlockFor(Bs.leaf), leafHashBs = tapLeafHash(Bs.leaf), ctrlLeafHash = tapLeafHash(ctrlCov.leaf);
  const ctrlOutpoint = op(gC.genesisTxid, 0), d1Outpoint = op(recD1.committedTxid, 2);

  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(recD1.committedTxid, 2, 0xffffffff);   // vin0 = D1 (SCRIPT)
  tx.addInput(gC.genesisTxid, 0, 0xffffffff);        // vin1 = the controller note
  const outNoteVal = 30000, changeVal = recD1.valueSats + Number(cVAL) - outNoteVal - 20000;
  const outs = [{ value: outNoteVal, script: ownSPK }, { value: 0, script: stateScript(G, 7_000_000n, OWNER_0, KEY) }, { value: changeVal, script: CHG }]; // withdraw script→key
  for (const o of outs) tx.addOutput(o.script, o.value);
  const prevSpks = [ownSPK, controllerSPK], prevVals = [recD1.valueSats, Number(cVAL)];
  const parts = sighashComponents({ inputs: [
    { txid: display(recD1.committedTxid), vout: 2, value: recD1.valueSats, spk: ownSPK, sequence: 0xffffffff },
    { txid: display(gC.genesisTxid), vout: 0, value: Number(cVAL), spk: controllerSPK, sequence: 0xffffffff },
  ], outputs: outs });

  // vin0 — the SCRIPT-arm gp=merge leaf (inIndex 0).
  const real0 = tx.hashForWitnessV1(0, prevSpks, prevVals, DEFAULT, leafHashBs);
  const sig0 = Buffer.from(ecc.signSchnorr(real0, priv));
  const s0 = reassembleSighash({ inIndex: 0, leafHash: leafHashBs, parts });
  const w0 = transferMergeGrandparentV2Witness({
    parent: { committedTxidP: recD1.committedTxid, vin0Outpoint: recD1.vin0Outpoint, changeVal: recD1.changeVal, outputs: recD1.outputs },
    mergeGp: ctx.mergeGpPieces, epi: { sig: sig0, P, c1: s0.pre, c3: parts.shaAmounts, c5: parts.shaSequences, c7: s0.mid, c8: leafHashBs, c9: s0.post },
    ownSPK, changeValue: changeVal, out: { owner: OWNER_0, value: outNoteVal, ownerType: KEY }, amountIn: 7_000_000n,
    cw: { curChangeSpk: CHG, parChangeSpk: CHG }, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId },
  });
  // vin1 — the controller leaf (inIndex 1).
  const real1 = tx.hashForWitnessV1(1, prevSpks, prevVals, DEFAULT, ctrlLeafHash);
  const sig1 = Buffer.from(ecc.signSchnorr(real1, priv));
  const s1 = reassembleSighash({ inIndex: 1, leafHash: ctrlLeafHash, parts });
  const w1 = [ctrlCommitted, d1Outpoint, ownSPK, controllerSPK, u64(BigInt(cGenChangeVal)), cGenChangeSPK,
    sig1, P, s1.pre, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, ctrlLeafHash, s1.post];

  assert.equal(runScript(transferMergeGrandparentV2Ops(2, 1, N, cScript).ops, w0, real0).ok, true, 'SCRIPT-arm gp=merge scriptsim GREEN');
  assert.equal(runScript(controllerLeafOps(ctrlConsts).ops, w1, real1).ok, true, 'controller leaf scriptsim GREEN');
  tx.ins[0].witness = [...w0, Bs.leaf, cbBs];
  tx.ins[1].witness = [...w1, ctrlCov.leaf, ctrlCov.controlBlock];
  const acc = await expectAccept(tx.toHex());
  assert.ok(acc.confirmations >= 1, 'SCRIPT-arm gp=merge co-spend not confirmed');
  console.log(`  STEP 10 GREEN (case B SCRIPT arm): D1 WITHDRAWN script→key, BOTH leaves passed (gp=merge SCRIPT-arm @vin0 + controller @vin1) ${acc.txid}`);
  console.log('\n✅ MERGE gp=merge SCRIPT ARM at CONSENSUS: a merged-note descendant deposited to a no-escape controller is withdrawn via the controller co-spend — the full DeFi composition.\n');
});
