// P2-5 LINEAGE v2 — the SPLIT-CHILD grandparent at CONSENSUS (lineage completeness, real Schnorr). Proves a split-of-a-split
// chain on-node: txGP (a degree-Mp_gp split, out[2j']=note@ownSPK) → txP (a degree-Mp split spending txGP.out[2j']) → spend
// child j via the split-grandparent leaf. The arm reconstructs txGP and forces hash256(txGP)‖2j' == txP.vin0 (j' FORCED by the
// EQUALVERIFY). 2-leaf taptree {OP_TRUE (fixture spends), the split-grandparent leaf}. Run (regtest up): node --test native/p1e3_split_grandparent_split_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, WALLET, NUMS, REGTEST } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { splitFullLineageSplitGrandparentOps, buildSplitFullLineageSplitGrandparentLeaf, splitGrandparentSplit } from './p1e3SplitGrandparent.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 split-grandparent regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const stateScript = (G, amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77);

function make2Leaf(leafA, leafB) {
  const scriptTree = [{ output: leafA }, { output: leafB }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(leafA), pB = mk(leafB);
  if (!pA.output.equals(pB.output)) throw new Error('2-leaf taptree addresses diverge');
  return { output: pA.output, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('P2-5 SPLIT-GRANDPARENT at CONSENSUS: txGP(split) → txP(split) → spend child j, real Schnorr; wrong-j\' rejected', { skip }, async () => {
  const Mp = 2, j = 1, M = 2, Mp_gp = 2, jprime = 1;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK };
  const leafV2 = buildSplitFullLineageSplitGrandparentLeaf(Mp, j, M, N, Mp_gp, consts);
  const tt = make2Leaf(opTrue.leaf, leafV2);
  const ownSPK = tt.output;
  console.log(`\nP2-5 split-grandparent leaf (${leafV2.length}B)`);

  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);

  // ---- txGP = a degree-Mp_gp split (mono-input from a plain OP_TRUE UTXO); out[2j'] = the note txP spends, at ownSPK.
  const src = await fund(opTrue, 2);
  const gpVin0Outpoint = Buffer.concat([Buffer.from(src.fundTxid, 'hex').reverse(), u32le(src.vout)]);
  const gpKids = [{ value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xe0) }, { value: 900000, amount: 14_000_000n, owner: Buffer.alloc(20, 0xe1) }];
  const changeValGp = src.valueSats - gpKids.reduce((a, c) => a + c.value, 0) - 1000000;
  const gp = splitGrandparentSplit({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint, jprime, kids: gpKids, changeValGp });
  // construct + broadcast txGP, asserting byte-exact == the covenant's reconstruction.
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(src.fundTxid, 'hex').reverse(), src.vout, 0xffffffff);
  for (const c of gpKids) { txGP.addOutput(ownSPK, c.value); txGP.addOutput(stateScript(G, c.amount, c.owner), 0); }
  txGP.addOutput(changeSPK, changeValGp);
  assert.ok(txGP.toBuffer().equals(gp.txGP), 'txGP legacy == splitGrandparentSplit reconstruction (byte-exact split)');
  const committedTxidGP = hash256(gp.txGP);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  console.log(`  txGP (split, out[${2 * jprime}]=note@ownSPK) ${Buffer.from(committedTxidGP).reverse().toString('hex')}`);

  // ---- txP = a degree-Mp split spending txGP.out[2j'] (via the taptree OP_TRUE leaf) -> Mp children at ownSPK + change.
  const txpChildren = [{ value: 100000, amount: 6_000_000n, owner: Buffer.alloc(20, 0xc0) }, { value: 500000, amount: 14_000_000n, owner: owner_in }];
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(committedTxidGP, 2 * jprime, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner), 0); }
  const txpChange = gpKids[jprime].value - 600000 - 100000;
  txP.addOutput(changeSPK, txpChange);
  const txPLegacy = txP.toBuffer();
  const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, tt.cbA];
  await expectAccept(txP.toHex());
  console.log(`  txP (split @ownSPK, vin0=txGP.out[${2 * jprime}]) ${Buffer.from(committedTxidP).reverse().toString('hex')}`);

  // ---- spend child j (txP.tokenOut_j @ 2j) via the split-grandparent leaf, real Schnorr.
  const note = { valueSats: txpChildren[j].value };
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const changeValue = note.valueSats - 80000 - 20000;

  const buildSpend = ({ voutPieceOverride } = {}) => {
    const amountIn = children.reduce((a, c) => a + c.amount, 0n);
    const leafHash = tapLeafHash(leafV2);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(committedTxidP, 2 * j, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner) }); }
    outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const txidHex = Buffer.from(committedTxidP).reverse().toString('hex');
    const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitFullLineageWitness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChange, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) },
      epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount })), amountIn, N });
    const pieces = gp.pieces.map((b) => Buffer.from(b));
    if (voutPieceOverride !== undefined) pieces[2] = u32le(voutPieceOverride);   // tamper witness_vout
    return { tx, w: [...w, ...pieces], real };
  };

  const g = buildSpend();
  assert.equal(runScript(splitFullLineageSplitGrandparentOps(Mp, j, M, N, Mp_gp, consts), g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  g.tx.ins[0].witness = [...g.w, leafV2, tt.cbB];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'split-grandparent spend not confirmed');
  console.log(`  GREEN: split→split→spend child ${j} confirmed ${acc.txid} — hash256(txGP_split)‖${2 * jprime}==txP.vin0`);

  // RED — WRONG j': claim witness_vout for j'=0 (vout 0) while txP.vin0 points at vout 2 -> hash256(txGP)‖0 != txP.vin0 -> reject.
  const r = buildSpend({ voutPieceOverride: 0 });
  r.tx.ins[0].witness = [...r.w, leafV2, tt.cbB];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'wrong j\' (witness_vout) must be rejected at block-validation');
  console.log('  RED wrong-j\': rejected at block-validation (hash256(txGP)‖0 ≠ txP.vin0 ‖2)');
  console.log('\n✅ P2-5 SPLIT-GRANDPARENT at CONSENSUS: split-of-a-split lineage closed with real Schnorr.\n');
});
