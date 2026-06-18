// P2-0 BRICK 0 — the FULL v2 fund-safe lineage at CONSENSUS: genesis(v2 mint) → split(v2) → spend a KEY child j via the v2
// genesis-grandparent leaf, real Schnorr. Confirms the +1-byte owner_type shift in the grandparent reconstruction is byte-exact
// on-node + the depth-2 lineage (hash256(txGP_v2)‖00 == txP.vin0) holds on the 66B state. Run: node --test native/p1e3_split_grandparent_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, WALLET, NUMS, REGTEST } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { encodeStateV2, encodeAmount, tokenId, OwnerType } from './wire.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { splitFullLineageGenesisGrandparentV2Ops, buildSplitFullLineageGenesisGrandparentV2Leaf, genesisGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 v2 grandparent regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77), AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);

function make2Leaf(a, b) {
  const scriptTree = [{ output: a }, { output: b }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(a), pB = mk(b);
  if (!pA.output.equals(pB.output)) throw new Error('taptree diverge');
  return { output: pA.output, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('P2-0 v2 grandparent at CONSENSUS: genesis(v2) → split(v2) → spend KEY child j, real Schnorr', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
  const leafV2 = buildSplitFullLineageGenesisGrandparentV2Leaf(Mp, j, M, N, consts);
  const tt = make2Leaf(opTrue.leaf, leafV2);
  const ownSPK = tt.output;
  console.log(`\nP2-0 v2 genesis-grandparent leaf (${leafV2.length}B)`);

  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);

  // txGP = the v2 genesis mint (out0 = the genesis note @ ownSPK, KEY-owned).
  const mgp = await fund(opTrue, 1);
  const changeValueGp = BigInt(mgp.valueSats + gf.valueSats) - VALUE_0 - feeVal - 1_000_000n;
  const changeSPKgp = p2tr(0x88);
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: outpointOf(mgp), changeSPKgp, changeValueGp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, Number(changeValueGp));
  assert.ok(txGP.toBuffer().equals(gp.txGP), 'txGP legacy == v2 reconstruction (byte-exact mint)');
  const committedTxidGP = hash256(gp.txGP);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  console.log(`  txGP (v2 mint) ${Buffer.from(committedTxidGP).reverse().toString('hex')}`);

  // txP = a v2 split spending txGP.out0; child j KEY-owned (owner_in, 14M).
  const txpChildren = [{ value: 100000, amount: 6_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY }, { value: 500000, amount: 14_000_000n, owner: owner_in, ownerType: OwnerType.KEY }];
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(committedTxidGP, 0, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txpChange = Number(VALUE_0) - 600000 - 100000;
  txP.addOutput(changeSPK, txpChange);
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, tt.cbA];
  await expectAccept(txP.toHex());
  console.log(`  txP (v2 split) ${Buffer.from(committedTxidP).reverse().toString('hex')}`);

  // spend child j → KEY + SCRIPT children (a key→script deposit) via the v2 genesis-grandparent leaf.
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const note = { valueSats: txpChildren[j].value };
  const leafHash = tapLeafHash(leafV2);
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidP, 2 * j, 0xffffffff);
  const outs = [];
  for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
  const changeValue = note.valueSats - 80000 - 20000;
  outs.push({ value: changeValue, script: changeSPK });
  for (const o of outs) tx.addOutput(o.script, o.value);
  const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const parts = sighashComponents({ inputs: [{ txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChange, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N });
  const full = [...w, ...gp.pieces];
  assert.equal(runScript(splitFullLineageGenesisGrandparentV2Ops(Mp, j, M, N, consts), full, real).ok, true, 'scriptsim GREEN before broadcast');
  tx.ins[0].witness = [...full, leafV2, tt.cbB];
  const acc = await expectAccept(tx.toHex());
  assert.ok(acc.confirmations >= 1, 'v2 genesis→split→spend not confirmed');
  console.log(`  GREEN: v2 genesis→split→spend child ${j} confirmed ${acc.txid} — full v2 lineage at consensus`);

  // RED mint-from-nothing: txP2 vin0 = a plain OP_TRUE UTXO (not txGP.out0) -> grandparent EQUALVERIFY fails.
  const fakeIn = await fund(opTrue, 1);
  const txp2 = new bells.Transaction(); txp2.version = 2;
  txp2.addInput(Buffer.from(fakeIn.fundTxid, 'hex').reverse(), fakeIn.vout, 0xffffffff);
  for (const c of txpChildren) { txp2.addOutput(ownSPK, c.value); txp2.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txp2Change = fakeIn.valueSats - 600000 - 100000; txp2.addOutput(changeSPK, txp2Change);
  const l2 = txp2.toBuffer(); const cP2 = hash256(l2), vin02 = l2.subarray(5, 41);
  txp2.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; // fakeIn is a plain single-leaf OP_TRUE UTXO (NOT at ownSPK)
  await expectAccept(txp2.toHex());
  const tx2 = new bells.Transaction(); tx2.version = 2;
  tx2.addInput(cP2, 2 * j, 0xffffffff);
  for (const o of outs) tx2.addOutput(o.script, o.value);
  const real2 = tx2.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig2 = Buffer.from(ecc.signSchnorr(real2, priv));
  const parts2 = sighashComponents({ inputs: [{ txid: Buffer.from(cP2).reverse().toString('hex'), vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const r2 = reassembleSighash({ inIndex: 0, leafHash, parts: parts2 });
  const w2 = splitFullLineageV2Witness({ parent: { committedTxidP: cP2, vin0Outpoint: vin02, changeVal: txp2Change, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig: sig2, P, c1: r2.pre, c3: parts2.shaAmounts, c5: parts2.shaSequences, c7: r2.mid, c8: leafHash, c9: r2.post }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N });
  tx2.ins[0].witness = [...w2, ...gp.pieces, leafV2, tt.cbB];
  assert.equal((await notMinable(tx2.toHex())).mined, false, 'mint-from-nothing rejected at block-validation');
  console.log('  RED mint-from-nothing: rejected at block-validation');
  console.log('\n✅ P2-0 FULL v2 fund-safe lineage at CONSENSUS (66B owner_type state, depth-2 genesis grandparent).\n');
});
