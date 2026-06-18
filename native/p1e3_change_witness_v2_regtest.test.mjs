// P2-0 FREEZE — the changeWitness PRODUCTION path at CONSENSUS (the de-centralization win), real Schnorr. The frozen $BOUND leaves
// are changeWitness=true (spender-chosen sat-change, not one baked address). Chain: mint(v2) → split(txP, change→CHANGE_PARENT) →
// spend a KEY child via the changeWitness genesis-grandparent leaf with the spend's change → CHANGE_SPEND (≠ CHANGE_PARENT ≠ the
// genesis change). Proves THREE distinct, witness-chosen change addresses bind at block-validation. RED: a witness curChangeSpk that
// ≠ the real change output (c6/CSFS) rejects. Run (node up): node --test native/p1e3_change_witness_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, NUMS, REGTEST } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, encodeAmount, tokenId, OwnerType } from './wire.mjs';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Witness, withChangeWitness } from './p1e3SplitFullLineageV2.mjs';
import { splitFullLineageGenesisGrandparentV2Ops, buildSplitFullLineageGenesisGrandparentV2Leaf, genesisGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 changeWitness regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);
const CHANGE_PARENT = p2tr(0x66), CHANGE_SPEND = p2tr(0x77), CONST_PLACEHOLDER = p2tr(0xde), changeSPKgp = p2tr(0x88);

function make2Leaf(a, b) {
  const scriptTree = [{ output: a }, { output: b }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(a), pB = mk(b);
  return { output: pA.output, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('P2-0 changeWitness at CONSENSUS: 3 distinct spender-chosen change addresses (genesis/parent/spend) bind, real Schnorr', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  const consts = { tokenId: undefined, changeSPK: CONST_PLACEHOLDER, changeWitness: true }; // tokenId filled below
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1), owner_in = H160(P);

  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  consts.tokenId = G;
  const cfull = { tokenId: G, changeSPK: CONST_PLACEHOLDER, changeWitness: true, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
  const leaf = buildSplitFullLineageGenesisGrandparentV2Leaf(Mp, j, M, N, cfull);
  const tt = make2Leaf(opTrue.leaf, leaf);
  const ownSPK = tt.output;
  console.log(`\nP2-0 changeWitness genesis-gp leaf ${leaf.length}B`);

  // txGP = v2 genesis mint (change → changeSPKgp, a witness gp change).
  const mgp = await fund(opTrue, 1);
  const changeValueGp = BigInt(mgp.valueSats + gf.valueSats) - VALUE_0 - feeVal - 1_000_000n;
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: outpointOf(mgp), changeSPKgp, changeValueGp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, Number(changeValueGp));
  assert.ok(txGP.toBuffer().equals(gp.txGP), 'txGP byte-exact');
  const committedTxidGP = hash256(gp.txGP);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());

  // txP = a v2 split spending txGP.out0; its change → CHANGE_PARENT (the parent spender's choice = parChangeSpk for the spend).
  const txpChildren = [{ value: 100000, amount: 6_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY }, { value: 500000, amount: 14_000_000n, owner: owner_in, ownerType: OwnerType.KEY }];
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(committedTxidGP, 0, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txpChange = Number(VALUE_0) - 600000 - 100000;
  txP.addOutput(CHANGE_PARENT, txpChange);                                    // ≠ the const placeholder, ≠ CHANGE_SPEND
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, tt.cbA];
  await expectAccept(txP.toHex());
  console.log(`  txP change → CHANGE_PARENT(0x66)`);

  // spend child j → M children, the spend's change → CHANGE_SPEND (≠ CHANGE_PARENT). curChangeSpk/parChangeSpk both WITNESS.
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const note = { valueSats: txpChildren[j].value }, leafHash = tapLeafHash(leaf);
  const buildSpend = (badCur) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(committedTxidP, 2 * j, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
    const changeValue = note.valueSats - 80000 - 20000; outs.push({ value: changeValue, script: CHANGE_SPEND });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const base = splitFullLineageV2Witness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChange, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
      epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N });
    const full = [...withChangeWitness(base, { curChangeSpk: badCur ?? CHANGE_SPEND, parChangeSpk: CHANGE_PARENT }), ...gp.pieces];
    return { tx, full, real };
  };

  const g = buildSpend();
  assert.equal(runScript(splitFullLineageGenesisGrandparentV2Ops(Mp, j, M, N, cfull), g.full, g.real).ok, true, 'changeWitness scriptsim GREEN');
  g.tx.ins[0].witness = [...g.full, leaf, tt.cbB];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'changeWitness spend not confirmed');
  console.log(`  GREEN: spend change → CHANGE_SPEND(0x77), 3 distinct witness changes bind ${acc.txid}`);

  // RED: a witness curChangeSpk that does NOT match the real change output (the tx pays CHANGE_SPEND, witness claims a different SPK).
  const r = buildSpend(p2tr(0xee));
  r.tx.ins[0].witness = [...r.full, leaf, tt.cbB];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'a forged curChangeSpk (c6 mismatch) rejected at block-validation');
  console.log('  RED forged curChangeSpk: rejected at block-validation');
  console.log('\n✅ P2-0 changeWitness at CONSENSUS: spender-chosen change (no baked address) binds with real Schnorr.\n');
});
