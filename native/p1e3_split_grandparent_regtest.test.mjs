// P2-5 LINEAGE v2 + GRANDPARENT at CONSENSUS (Step 8, 6b — the FULL fund-safe split-child leaf) with REAL Schnorr. Proves the
// mint-from-nothing closure on-node: a real GENESIS chain txGP(2-input mint) → txP(split spending txGP.out0) → spend child j.
// The leaf reconstructs txGP + txP, forces hash256(txGP)‖00 == txP.vin0 ∧ txGP.out0==ownSPK ∧ token_id==G, conserves Σ children
// == backtrace amount_in, and binds the real sighash. The covenant ownSPK is a 2-LEAF taptree {OP_TRUE (fixture spends), the
// grandparent leaf (under test)} so txGP.out0 / txP's children all live at ownSPK and the OP_TRUE leaf creates the fixtures.
// Run (regtest up): node --test native/p1e3_split_grandparent_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, WALLET, NUMS, REGTEST } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { splitFullLineageGrandparentOps, buildSplitFullLineageGrandparentLeaf, genesisGrandparent } from './p1e3SplitGrandparent.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 lineage-v2 + grandparent regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const stateScript = (G, amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n;
const feeOut = Buffer.concat([(() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(feeVal); return b; })(), Buffer.from([0x22]), feeSPK]);

// a 2-leaf taproot covenant {leafA, leafB}; returns the shared output + each leaf's control block.
function make2Leaf(leafA, leafB) {
  const scriptTree = [{ output: leafA }, { output: leafB }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(leafA), pB = mk(leafB);
  if (!pA.output.equals(pB.output)) throw new Error('2-leaf taptree addresses diverge');
  return { output: pA.output, address: pA.address, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('P2-5 LINEAGE v2 + GRANDPARENT at CONSENSUS: genesis → split(txP) → spend child j, real Schnorr; mint-from-nothing rejected', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);                                    // G = the genesis outpoint (vin1 of the mint)
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
  const leafV2 = buildSplitFullLineageGrandparentLeaf(Mp, j, M, N, consts);
  const tt = make2Leaf(opTrue.leaf, leafV2);                          // ownSPK = {OP_TRUE, grandparent leaf}
  const ownSPK = tt.output;
  console.log(`\nP2-5 lineage-v2 + grandparent leaf ${tt.address} (${leafV2.length}B)`);

  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);

  // ---- txGP = the 2-input GENESIS mint. vin0 = M_gp (a funded OP_TRUE), vin1 = G; out0 = the genesis note at ownSPK (VALUE_0).
  const mgp = await fund(opTrue, 1);
  const inSum = mgp.valueSats + gf.valueSats;
  const changeValueGp = BigInt(inSum) - VALUE_0 - feeVal - 1_000_000n;  // leftover after the mint outputs + a generous fee
  const changeSPKgp = p2tr(0x88);
  const gp = genesisGrandparent({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: outpointOf(mgp), changeSPKgp, changeValueGp });
  // construct + broadcast txGP, asserting its legacy serialization == the covenant's reconstruction (byte-exact mint shape).
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(Buffer.from([0x6a, 0x20, ...S(encodeState({ tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))]), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, Number(changeValueGp));
  assert.ok(txGP.toBuffer().equals(gp.txGP), 'txGP legacy == genesisGrandparent reconstruction (byte-exact mint)');
  const committedTxidGP = hash256(gp.txGP);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  console.log(`  txGP (genesis mint, out0=note@ownSPK) ${Buffer.from(committedTxidGP).reverse().toString('hex')}`);

  // ---- txP = a split spending txGP.out0 (via the taptree's OP_TRUE leaf) → M'=2 children at ownSPK + change.
  const txpChildren = [
    { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xc0) },
    { value: 500000, amount: 14_000_000n, owner: owner_in },           // child j=1 — the note we spend
  ];
  const buildTxP = (vin0FundTxid, vin0Vout, inputSats) => {
    const t = new bells.Transaction(); t.version = 2;
    t.addInput(Buffer.from(vin0FundTxid, 'hex').reverse(), vin0Vout, 0xffffffff);
    for (const c of txpChildren) { t.addOutput(ownSPK, c.value); t.addOutput(stateScript(G, c.amount, c.owner), 0); }
    const change = inputSats - 600000 - 100000;                        // input funds 2 children (600000) + a 100000 fee
    t.addOutput(changeSPK, change);
    return { t, legacy: t.toBuffer(), change };
  };
  const txpB = buildTxP(Buffer.from(committedTxidGP).reverse().toString('hex'), 0, Number(VALUE_0)); // spend txGP.out0
  const committedTxidP = hash256(txpB.legacy), vin0Outpoint = txpB.legacy.subarray(5, 41);
  txpB.t.ins[0].witness = [opTrue.leaf, tt.cbA];                       // reveal the taptree's OP_TRUE leaf to spend txGP.out0
  await expectAccept(txpB.t.toHex());
  console.log(`  txP (split @ownSPK, vin0=txGP.out0) ${Buffer.from(committedTxidP).reverse().toString('hex')}`);

  // ---- spend child j (txP.tokenOut_j @ 2j) via the grandparent leaf (genesis arm) with real Schnorr.
  const note = { valueSats: txpChildren[j].value };
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const changeValue = note.valueSats - 80000 - 20000;

  const buildSpend = ({ ctxidP, vin0Op, txpChangeVal, children, amountInOverride, gpPieces }) => {
    const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : children.reduce((a, c) => a + c.amount, 0n);
    const leafHash = tapLeafHash(leafV2);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(ctxidP, 2 * j, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner) }); }
    outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const txidHex = Buffer.from(ctxidP).reverse().toString('hex');
    const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitFullLineageWitness({
      parent: { committedTxidP: ctxidP, vin0Outpoint: vin0Op, changeVal: txpChangeVal, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) },
      epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
      ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount })), amountIn, N,
    });
    return { tx, w: [...w, ...gpPieces], real };
  };

  // GREEN — scriptsim pre-check then broadcast (gpPieces = the genesis mint pieces).
  const g = buildSpend({ ctxidP: committedTxidP, vin0Op: vin0Outpoint, txpChangeVal: txpB.change, children, gpPieces: gp.pieces });
  assert.equal(runScript(splitFullLineageGrandparentOps(Mp, j, M, N, consts), g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  g.tx.ins[0].witness = [...g.w, leafV2, tt.cbB];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'genesis-grandparent split-child spend not confirmed');
  console.log(`  GREEN: genesis→split→spend child ${j} confirmed ${acc.txid} — hash256(txGP)‖00==txP.vin0, Σ==backtrace amount_in`);

  // RED — MINT-FROM-NOTHING: a txP2 whose vin0 is a plain OP_TRUE UTXO (NOT a covenant note). Feeding the honest genesis pieces,
  // the rebuilt hash256(txGP)‖00 != txP2.vin0 -> the grandparent EQUALVERIFY fails at block-validation.
  const fakeIn = await fund(opTrue, 1);
  const txp2 = buildTxP(fakeIn.fundTxid, fakeIn.vout, fakeIn.valueSats);
  const ctxidP2 = hash256(txp2.legacy), vin0Op2 = txp2.legacy.subarray(5, 41);
  txp2.t.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txp2.t.toHex());
  const r = buildSpend({ ctxidP: ctxidP2, vin0Op: vin0Op2, txpChangeVal: txp2.change, children, gpPieces: gp.pieces });
  r.tx.ins[0].witness = [...r.w, leafV2, tt.cbB];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'mint-from-nothing (txP.vin0 not a covenant note) must be rejected at block-validation');
  console.log('  RED mint-from-nothing (txP.vin0 ≠ a real covenant note): rejected at block-validation');
  console.log('\n✅ P2-5 LINEAGE v2 + GRANDPARENT at CONSENSUS: depth-2 lineage (genesis→split→spend) + mint-from-nothing closure, real Schnorr.\n');
});
