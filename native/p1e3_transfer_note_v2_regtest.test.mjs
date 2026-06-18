// P2-0 FREEZE — send-all-mint + the TRANSFER-NOTE Mp=1 base case at CONSENSUS, real Schnorr. This validates Claude's override of the
// freeze workflow (the minimal Mp=1 fix vs a new kernel). Chain: mint(v2) → SEND-ALL the whole supply (transferAMono = a degree-1
// split / mono-transfer) → spend the resulting TRANSFER note via the Mp=1 split-genesis-grandparent leaf (the kernel reconstructs the
// degree-1 1→1 tx byte-exact: HDR_S==HDR_T ∧ splitMid(1)==CONT_MID). Proves a 1→1 output is NOT a dead note. RED inflation rejects.
// Run (node up): node --test native/p1e3_transfer_note_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, NUMS, REGTEST } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, encodeAmount, OwnerType, tokenId } from './wire.mjs';
import { u64 } from './sighashParts.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { buildTransferAMonoV2Leaf, transferAMonoV2Witness, transferAMonoV2Ops, monoGenesisTx } from './p1e3MonoGenesisV2.mjs';
import { splitFullLineageGenesisGrandparentV2Ops, buildSplitFullLineageGenesisGrandparentV2Leaf, genesisGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 transfer-note regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77), AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);
const changeSPKgp = p2tr(0x88);
const pk = (priv) => Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);

// a balanced taptree over N leaf Buffers; cbFor(leaf) → its control block.
function makeTree(leaves) {
  const build = (a) => a.length === 1 ? { output: a[0] } : [build(a.slice(0, Math.ceil(a.length / 2))), build(a.slice(Math.ceil(a.length / 2)))];
  const scriptTree = build(leaves);
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  return { output: mk(leaves[0]).output, cbFor: (leaf) => { const p = mk(leaf); return p.witness[p.witness.length - 1]; } };
}

test('P2-0 send-all-mint + TRANSFER-NOTE Mp=1 at CONSENSUS: mint → 1→1 the whole supply → spend the transfer note, real Schnorr', { skip }, async () => {
  const M = 2;
  const priv0 = Buffer.alloc(32, 0x0b), P0 = pk(priv0), OWNER_0 = H160(P0);     // the mint note owner (the genesis owner)
  const priv1 = Buffer.alloc(32, 0x0c), P1 = pk(priv1), owner1 = H160(P1);     // the transfer note owner (the send-all recipient)

  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
  const sendAllLeaf = buildTransferAMonoV2Leaf(N, consts);                      // step 2: spend the mint note 1→1
  const respendLeaf = buildSplitFullLineageGenesisGrandparentV2Leaf(1, 0, M, N, consts); // step 3: spend the transfer note (Mp=1, gp=genesis)
  const tt = makeTree([opTrue.leaf, sendAllLeaf, respendLeaf]);
  const ownSPK = tt.output;
  console.log(`\nP2-0 send-all-mint leaf ${sendAllLeaf.length}B + transfer-note-Mp=1 leaf ${respendLeaf.length}B, covenant ${ownSPK.toString('hex').slice(0, 12)}…`);

  // STEP 1 — mint the v2 genesis (out0 = the MINT note @ ownSPK, KEY-owned by OWNER_0, amount AMOUNT_0).
  const mgp = await fund(opTrue, 1);
  const mintOutpoint = outpointOf(mgp);
  const changeValGp = mgp.valueSats + gf.valueSats - Number(VALUE_0) - Number(feeVal) - 1000000;
  const { genesisTxid, genesis } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeValGp, changeSPKgp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, changeValGp);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  console.log(`  STEP 1 v2 mint ${Buffer.from(genesisTxid).reverse().toString('hex')}`);

  // STEP 2 — SEND-ALL the whole supply: spend the mint note (genesisTxid@0) → ONE transfer note (owner1, AMOUNT_0), KEY-owned.
  const sLeafHash = tapLeafHash(sendAllLeaf);
  const out2 = { owner: owner1, value: 500000, ownerType: OwnerType.KEY };
  const tx2 = new bells.Transaction(); tx2.version = 2;
  tx2.addInput(genesisTxid, 0, 0xffffffff);
  tx2.addOutput(ownSPK, out2.value);
  tx2.addOutput(stateScript(G, AMOUNT_0, out2.owner, out2.ownerType), 0);
  const tx2Change = Number(VALUE_0) - out2.value - 20000;
  tx2.addOutput(changeSPK, tx2Change);
  const tx2Legacy = tx2.toBuffer();                                            // LEGACY (witness not set yet) — the txid + vin0 source
  const txid2 = hash256(tx2Legacy), vin0Outpoint2 = tx2Legacy.subarray(5, 41); // version(4)‖vinCount(1) then the 36B outpoint
  const real2 = tx2.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, sLeafHash);
  const sig2 = Buffer.from(ecc.signSchnorr(real2, priv0));
  const parts2 = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: [{ value: out2.value, script: ownSPK }, { value: 0, script: stateScript(G, AMOUNT_0, out2.owner, out2.ownerType) }, { value: tx2Change, script: changeSPK }] });
  const r2 = reassembleSighash({ inIndex: 0, leafHash: sLeafHash, parts: parts2 });
  const w2 = transferAMonoV2Witness({ genesis, epi: { sig: sig2, P: P0, c1: r2.pre, c3: parts2.shaAmounts, c5: parts2.shaSequences, c7: r2.mid, c8: sLeafHash, c9: r2.post }, ownSPK, changeValue: tx2Change, out: out2, amountIn: AMOUNT_0 });
  assert.equal(runScript(transferAMonoV2Ops(N, consts).ops, w2, real2).ok, true, 'send-all-mint scriptsim GREEN');
  tx2.ins[0].witness = [...w2, sendAllLeaf, tt.cbFor(sendAllLeaf)];
  const acc2 = await expectAccept(tx2.toHex());
  console.log(`  STEP 2 send-all-mint (whole supply → 1 transfer note) ${acc2.txid}`);

  // STEP 3 — spend the TRANSFER note (tx2@vout0) via the Mp=1 split leaf (gp=genesis) → M children, Σ==AMOUNT_0. The kernel
  //          reconstructs tx2 (a degree-1 split = the 1→1 mono-transfer); the grandparent arm reconstructs the genesis mint.
  const rLeafHash = tapLeafHash(respendLeaf);
  const children = [{ amount: 8_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 13_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.KEY }];
  const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeSPKgp, changeValueGp: BigInt(changeValGp) });
  const buildSpend3 = (infl = 0n) => {
    const tx3 = new bells.Transaction(); tx3.version = 2;
    tx3.addInput(txid2, 0, 0xffffffff);                                       // vin0 = the transfer note @ vout0
    const outs = [];
    for (const c of children) { const amt = infl && c === children[1] ? c.amount + infl : c.amount; outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, amt, c.owner, c.ownerType) }); }
    const changeValue = out2.value - 80000 - 20000; outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx3.addOutput(o.script, o.value);
    const real3 = tx3.hashForWitnessV1(0, [ownSPK], [out2.value], bells.Transaction.SIGHASH_DEFAULT, rLeafHash);
    const sig3 = Buffer.from(ecc.signSchnorr(real3, priv1));
    const parts3 = sighashComponents({ inputs: [{ txid: Buffer.from(txid2).reverse().toString('hex'), vout: 0, value: out2.value, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const r3 = reassembleSighash({ inIndex: 0, leafHash: rLeafHash, parts: parts3 });
    const outsW = children.map((c) => ({ owner: c.owner, value: c.satValue, amount: infl && c === children[1] ? c.amount + infl : c.amount, ownerType: c.ownerType }));
    const w3 = splitFullLineageV2Witness({ parent: { committedTxidP: txid2, vin0Outpoint: vin0Outpoint2, changeVal: tx2Change, outputs: [{ value: out2.value, amountSer: encodeAmount(AMOUNT_0), owner: owner1, ownerType: OwnerType.KEY }] },
      epi: { sig: sig3, P: P1, c1: r3.pre, c3: parts3.shaAmounts, c5: parts3.shaSequences, c7: r3.mid, c8: rLeafHash, c9: r3.post }, ownSPK, changeValue, outs: outsW, amountIn: AMOUNT_0, N });
    return { tx3, full: [...w3, ...gp.pieces], real3 };
  };

  const g3 = buildSpend3();
  assert.equal(runScript(splitFullLineageGenesisGrandparentV2Ops(1, 0, M, N, consts), g3.full, g3.real3).ok, true, 'transfer-note-Mp=1 scriptsim GREEN');
  g3.tx3.ins[0].witness = [...g3.full, respendLeaf, tt.cbFor(respendLeaf)];
  const acc3 = await expectAccept(g3.tx3.toHex());
  assert.ok(acc3.confirmations >= 1, 'transfer-note spend not confirmed');
  console.log(`  STEP 3 GREEN: the transfer note SPLIT → [8M, 13M] confirmed ${acc3.txid} — a 1→1 output is NOT a dead note (the freeze-blocker fix, at consensus)`);

  // RED inflation: Σ children != AMOUNT_0 (the conservation welds to the parked AMOUNT_0 backtraced through the Mp=1 kernel).
  const r = buildSpend3(1n);
  r.tx3.ins[0].witness = [...r.full, respendLeaf, tt.cbFor(respendLeaf)];
  assert.equal((await notMinable(r.tx3.toHex())).mined, false, 'inflated transfer-note split rejected at block-validation');
  console.log('  RED inflation: rejected at block-validation');
  console.log('\n✅ P2-0 send-all-mint + transfer-note Mp=1 at CONSENSUS: the 1→1 output is spendable (no fund loss), real Schnorr.\n');
});
