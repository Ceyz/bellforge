// FROZEN-TAPTREE consensus spends (regtest, real Schnorr) — promoted from the 2026-06-15 pre-freeze audit (docs/AUDIT_BOUND_PREFREEZE.md).
// The freeze tests (freeze_enumerate/freeze_deploy) only BUILD the taptree; NOTHING else spends a leaf in its EXACT frozen bytes
// through buildTaptree's real depth-9 (321B) control block. This does, for the load-bearing cells, with the inflation defense + the
// BIP-342 pins asserted ON the frozen artifact. Run (node up): node --test native/freeze_spend_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, NUMS, REGTEST } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, OwnerType, tokenId, encodeAmount } from './wire.mjs';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitAMonoV2Ops, splitAMonoV2Witness, transferAMonoV2Ops, transferAMonoV2Witness, monoGenesisTx } from './p1e3MonoGenesisV2.mjs';
import { splitFullLineageV2ScriptWitness, withChangeWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';
import { splitFullLineageSplitGrandparentV2Ops, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';
import { buildTaptree } from './freezeEnumerate.mjs';
import { freezeDeploy } from './p4/deploy.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nFROZEN-spend regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const CHANGE_PLACEHOLDER = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32)]);
const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);
const changeSPKgp = p2tr(0x88), curChangeSpk = p2tr(0x77), parChangeSpk = p2tr(0x88);

// mint a v2 genesis to the FROZEN transferSPK; return the frozen tree + the live mint note.
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
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, changeValGp);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  return { tree, ownSPK, G, genesisTxid, genesis, priv, P };
}

test('FROZEN root-split (CW=true) spends through the real depth-9 control block; RED inflation rejected on the frozen artifact', { skip }, async () => {
  const M = 2, { tree, ownSPK, G, genesisTxid, genesis, priv, P } = await mintFrozen();
  const leaf = tree.ordered.find((l) => l.id.fam === 'root-split' && l.id.M === M).leaf;
  const controlBlock = tree.controlBlockFor(leaf), leafHash = tapLeafHash(leaf);
  assert.equal(controlBlock.length, 33 + 32 * tree.depth, 'depth-9 control block');
  const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const build = ({ infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2; tx.addInput(genesisTxid, 0, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, infl && c === children[1] ? c.amount + infl : c.amount, c.owner, c.ownerType) }); }
    const changeValue = Number(VALUE_0) - 80000 - 20000; outs.push({ value: changeValue, script: curChangeSpk });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const outsW = children.map((c) => ({ owner: c.owner, value: c.satValue, amount: infl && c === children[1] ? c.amount + infl : c.amount, ownerType: c.ownerType }));
    const w = splitAMonoV2Witness({ genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: outsW, amountIn: AMOUNT_0, N, curChangeSpk, parChangeSpk });
    return { tx, w };
  };
  const r = build({ infl: 1n }); r.tx.ins[0].witness = [...r.w, leaf, controlBlock];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'RED inflation through the frozen cb rejected at block-validation');
  const g = build(); g.tx.ins[0].witness = [...g.w, leaf, controlBlock];
  assert.ok((await expectAccept(g.tx.toHex())).confirmations >= 1, 'frozen root-split spent through the real control block');
});

test('FROZEN root-sendall (CW=true) spends through the real control block; RED re-emit rejected', { skip }, async () => {
  const { tree, ownSPK, G, genesisTxid, genesis, priv, P } = await mintFrozen();
  const leaf = tree.ordered.find((l) => l.id.fam === 'root-sendall').leaf;
  const controlBlock = tree.controlBlockFor(leaf), leafHash = tapLeafHash(leaf);
  const out = { owner: Buffer.alloc(20, 0xa0), value: 300000, ownerType: OwnerType.KEY };
  const build = ({ infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2; tx.addInput(genesisTxid, 0, 0xffffffff);
    const changeValue = Number(VALUE_0) - out.value - 20000;
    const outs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(G, AMOUNT_0 + infl, out.owner, out.ownerType) }, { value: changeValue, script: curChangeSpk }];
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = transferAMonoV2Witness({ genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn: AMOUNT_0, curChangeSpk, parChangeSpk });
    return { tx, w };
  };
  const r = build({ infl: 1n }); r.tx.ins[0].witness = [...r.w, leaf, controlBlock];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'RED re-emit AMOUNT_0+1 rejected (1→1 byte-equality)');
  const g = build(); g.tx.ins[0].witness = [...g.w, leaf, controlBlock];
  assert.ok((await expectAccept(g.tx.toHex())).confirmations >= 1, 'frozen root-sendall (CW=true) spent — also validates the CWMONO-1 builder fix');
});

test('BIP-342 pins on the frozen v2 leaf: 33-byte P and 65-byte sig both reject; 32/64 control mines', { skip }, async () => {
  const M = 2, { tree, ownSPK, G, genesisTxid, genesis, priv, P } = await mintFrozen();
  const P33 = Buffer.from(ecc.pointFromScalar(priv, true)); // 33B compressed (the BIP-342 "unknown pubkey type")
  const leaf = tree.ordered.find((l) => l.id.fam === 'root-split' && l.id.M === M).leaf;
  const controlBlock = tree.controlBlockFor(leaf), leafHash = tapLeafHash(leaf);
  const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.KEY }];
  const build = ({ Pwit = P, sigOverride } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2; tx.addInput(genesisTxid, 0, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
    const changeValue = Number(VALUE_0) - 80000 - 20000; outs.push({ value: changeValue, script: curChangeSpk });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = sigOverride ?? Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitAMonoV2Witness({ genesis, epi: { sig, P: Pwit, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: AMOUNT_0, N, curChangeSpk, parChangeSpk });
    return { tx, w };
  };
  const a = build({ Pwit: P33, sigOverride: Buffer.alloc(64, 0x0c) }); a.tx.ins[0].witness = [...a.w, leaf, controlBlock];
  assert.equal((await notMinable(a.tx.toHex())).mined, false, '33-byte P rejected at the |P|==32 pin (BIP-342 bypass closed)');
  const b = build({ sigOverride: Buffer.alloc(65, 0x0c) }); b.tx.ins[0].witness = [...b.w, leaf, controlBlock];
  assert.equal((await notMinable(b.tx.toHex())).mined, false, '65-byte sig rejected at the |sig|==64 pin (forces SIGHASH_DEFAULT)');
  const g = build(); g.tx.ins[0].witness = [...g.w, leaf, controlBlock];
  assert.ok((await expectAccept(g.tx.toHex())).confirmations >= 1, '32B P / 64B sig control mines');
});

function make2Leaf(a, b) {
  const scriptTree = [{ output: a }, { output: b }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(a), pB = mk(b);
  if (!pA.output.equals(pB.output)) throw new Error('taptree diverge');
  return { output: pA.output, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('the WORST frozen leaf {split, gp=split-4, Mp=4, j=3, M=4, arm=script, CW=true} spends at consensus; RED inflation rejected', { skip }, async () => {
  // make2Leaf{OP_TRUE, worstLeaf} sets up txGP/txP via the OP_TRUE escape (this proves the LEAF BYTES execute — lineage soundness
  // is the C-1 no-escape test). Every offset path at once: 438B reconstructions, 2-input SCRIPT co-spend, BURN child, CW.
  const Mp = 4, j = 3, M = 4, Mp_gp = 4, jprime = 3, changeSpkGp = p2tr(0x88), parCh = p2tr(0x66), curCh = p2tr(0x77);
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const { buildSplitFullLineageSplitGrandparentV2Leaf } = await import('./p1e3SplitGrandparentV2.mjs');
  const consts = { tokenId: G, changeSPK: CHANGE_PLACEHOLDER, arm: 'script', changeWitness: true };
  const leaf = buildSplitFullLineageSplitGrandparentV2Leaf(Mp, j, M, N, Mp_gp, consts);
  const tt = make2Leaf(opTrue.leaf, leaf), ownSPK = tt.output;
  const controllerSPK = opTrue.output, poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
  const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
  const src = await fund(opTrue, 5);
  const gpKids = [{ value: 100000, amount: 5_000_000n, owner: Buffer.alloc(20, 0xe0), ownerType: OwnerType.KEY }, { value: 100000, amount: 6_000_000n, owner: Buffer.alloc(20, 0xe1), ownerType: OwnerType.KEY }, { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xe2), ownerType: OwnerType.KEY }, { value: 5_000_000, amount: 20_000_000n, owner: Buffer.alloc(20, 0xe3), ownerType: OwnerType.KEY }];
  const changeValGp = src.valueSats - gpKids.reduce((a, c) => a + c.value, 0) - 1000000;
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK: curCh, gpVin0Outpoint: outpointOf(src), jprime, kids: gpKids, changeValGp, changeSpkGp });
  const txGP = new bells.Transaction(); txGP.version = 2; txGP.addInput(Buffer.from(src.fundTxid, 'hex').reverse(), src.vout, 0xffffffff);
  for (const c of gpKids) { txGP.addOutput(ownSPK, c.value); txGP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  txGP.addOutput(changeSpkGp, changeValGp);
  assert.ok(txGP.toBuffer().equals(gp.txGP), 'txGP byte-exact');
  const committedTxidGP = hash256(gp.txGP);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; await expectAccept(txGP.toHex());
  const txpChildren = [{ value: 100000, amount: 1_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY }, { value: 100000, amount: 2_000_000n, owner: Buffer.alloc(20, 0xc1), ownerType: OwnerType.KEY }, { value: 100000, amount: 3_000_000n, owner: Buffer.alloc(20, 0xc2), ownerType: OwnerType.KEY }, { value: 1_000_000, amount: 14_000_000n, owner: SCRIPT_OWNER, ownerType: OwnerType.SCRIPT }];
  const txP = new bells.Transaction(); txP.version = 2; txP.addInput(committedTxidGP, 2 * jprime, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txpChange = gpKids[jprime].value - txpChildren.reduce((a, c) => a + c.value, 0) - 1000000;
  txP.addOutput(parCh, txpChange);   // txP change == parChangeSpk (kernel reconstructs the parent change from this under CW)
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, tt.cbA]; await expectAccept(txP.toHex());
  const ctrl = await fund(opTrue, 1), ctrlOutpoint = outpointOf(ctrl), noteVal = txpChildren[j].value, leafHash = tapLeafHash(leaf);
  const children = [{ amount: 2_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 3_000_000n, owner: Buffer.alloc(20, 0xa1), satValue: 40000, ownerType: OwnerType.SCRIPT }, { amount: 4_000_000n, owner: Buffer.alloc(20, 0xa2), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 5_000_000n, owner: Buffer.alloc(20, 0xa3), satValue: 40000, ownerType: OwnerType.BURN }];
  const build = ({ infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(committedTxidP, 2 * j, 0xffffffff); tx.addInput(Buffer.from(ctrl.fundTxid, 'hex').reverse(), ctrl.vout, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, infl && c === children[0] ? c.amount + infl : c.amount, c.owner, c.ownerType) }); }
    const changeValue = noteVal + ctrl.valueSats - 160000 - 1000000; outs.push({ value: changeValue, script: curCh });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK, controllerSPK], [noteVal, ctrl.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 2 * j, value: noteVal, spk: ownSPK, sequence: 0xffffffff }, { txid: ctrl.fundTxid, vout: ctrl.vout, value: ctrl.valueSats, spk: controllerSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const base = splitFullLineageV2ScriptWitness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChange, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) }, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
    return { tx, full: [...withChangeWitness(base, { curChangeSpk: curCh, parChangeSpk: parCh }), ...gp.pieces] };
  };
  const r = build({ infl: 1n }); r.tx.ins[0].witness = [...r.full, leaf, tt.cbB]; r.tx.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'RED inflation (Σ=amount_in+1) rejected on the worst frozen-bytes leaf');
  const g = build(); g.tx.ins[0].witness = [...g.full, leaf, tt.cbB]; g.tx.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  assert.ok((await expectAccept(g.tx.toHex())).confirmations >= 1, 'the WORST leaf spends at consensus (all offsets + 438B + 2-input SCRIPT + BURN + CW)');
});

test('R: a KEY-PATH spend of a frozen note REJECTS — NUMS dlog unknown ⇒ no valid key-path sig (key-path is dead)', { skip }, async () => {
  // Surface R: the frozen SPK is NUMS-tweaked; nobody knows the dlog of Q = lift_x(NUMS) + t·G, so no key-path signature can
  // exist. Mint the genesis note, then attempt a TAPROOT KEY-PATH spend (a 1-element 64-byte-sig witness) → must reject.
  const { ownSPK, genesisTxid } = await mintFrozen();
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(genesisTxid, 0, 0xffffffff);
  tx.addOutput(p2tr(0x77), Number(VALUE_0) - 20000);
  tx.ins[0].witness = [Buffer.alloc(64, 0x0c)];   // single 64B element ⇒ taproot key-path spend with a garbage Schnorr sig
  assert.equal((await notMinable(tx.toHex())).mined, false, 'key-path spend rejected — no valid sig for the NUMS-tweaked output key');
});
