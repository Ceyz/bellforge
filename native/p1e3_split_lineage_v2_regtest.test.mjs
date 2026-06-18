// P2-0 BRICK 0 — the v2 (owner_type) composed split-child leaf at CONSENSUS with REAL Schnorr. Proves what scriptsim CANNOT: the
// byte-exact 66B-state sighash (the +1-byte owner_type shift in c6) == bellsd's consensus tapscript sighash, AND the owner_type_in
// arm gate fires at block-validation. Chain: a v2 split-shaped txP (input a plain OP_TRUE UTXO; outputs M' children at ownSPK with
// v2 stateOuts) → SPEND a KEY child j → KEY + SCRIPT children (a key→script deposit). Run: node --test native/p1e3_split_lineage_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { encodeStateV2, encodeAmount, tokenId, OwnerType } from './wire.mjs';
import { splitFullLineageV2Ops, buildSplitFullLineageV2Leaf, splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 v2 regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const stateScript = (G, amount, owner, ownerType) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType, tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77);

test('P2-0 v2 leaf at CONSENSUS: spend a KEY split-child → KEY + SCRIPT children, real Schnorr; owner_type_in arm gate enforced', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const cov = makeCovenantRaw(buildSplitFullLineageV2Leaf(Mp, j, M, N, { tokenId: G, changeSPK }));
  const ownSPK = cov.output;
  console.log(`\nP2-0 v2 leaf (KEY) ${cov.address} (${cov.leaf.length}B)`);

  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);

  // build a v2 split txP whose child j is KEY-owned (owner_in); `jType` overrides it for the arm-gate RED.
  async function buildTxP(jType) {
    const kids = [
      { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY },
      { value: 300000, amount: 14_000_000n, owner: owner_in, ownerType: jType },
    ];
    const n0 = await fund(opTrue, 5);
    const txP = new bells.Transaction(); txP.version = 2;
    txP.addInput(Buffer.from(n0.fundTxid, 'hex').reverse(), n0.vout, 0xffffffff);
    for (const c of kids) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
    const txpChangeVal = n0.valueSats - 400000 - 1000000;
    txP.addOutput(changeSPK, txpChangeVal);
    const legacy = txP.toBuffer();
    const committedTxidP = hash256(legacy), vin0Outpoint = legacy.subarray(5, 41);
    txP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
    const txid = await rpc('sendrawtransaction', [txP.toHex()]);
    await rpc('generatetoaddress', [1, n0.mineAddr], { wallet: WALLET });
    assert.ok(Buffer.from(txid, 'hex').reverse().equals(committedTxidP), 'node txid == hash256(v2 txP)');
    return { committedTxidP, vin0Outpoint, txpChangeVal, jValue: kids[j].value,
      parent: { committedTxidP, vin0Outpoint, changeVal: txpChangeVal, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
  }

  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];

  const buildSpend = (txp, { children: kids, amountInOverride, mutate }) => {
    const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : kids.reduce((a, c) => a + c.amount, 0n);
    const leafHash = tapLeafHash(cov.leaf);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(txp.committedTxidP, 2 * j, 0xffffffff);
    const outs = [];
    for (const c of kids) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
    const changeValue = txp.jValue - 80000 - 20000;
    outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [txp.jValue], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
    const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValue, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: kids.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn, N });
    if (mutate) mutate(w);
    return { tx, w, real };
  };

  // GREEN — spend a KEY child → KEY + SCRIPT children (key→script deposit).
  const txp = await buildTxP(OwnerType.KEY);
  const g = buildSpend(txp, { children });
  assert.equal(runScript(splitFullLineageV2Ops(Mp, j, M, N, { tokenId: G, changeSPK }).ops, g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  g.tx.ins[0].witness = [...g.w, cov.leaf, cov.controlBlock];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'v2 KEY spend not confirmed');
  console.log(`  GREEN: KEY child 14M → [5M KEY, 9M SCRIPT] confirmed ${acc.txid} — v2 66B-state c6 byte-exact + key→script deposit`);

  // RED inflation
  const inflated = [{ amount: 5_000_001n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const r = buildSpend(txp, { children: inflated, amountInOverride: 14_000_000n });
  r.tx.ins[0].witness = [...r.w, cov.leaf, cov.controlBlock];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'inflation rejected at block-validation');
  console.log('  RED inflation: rejected at block-validation');

  // RED owner_type_in≠KEY — a SCRIPT-owned note spent via the KEY leaf (the arm gate at consensus).
  const txpScript = await buildTxP(OwnerType.SCRIPT);
  const rs = buildSpend(txpScript, { children });
  rs.tx.ins[0].witness = [...rs.w, cov.leaf, cov.controlBlock];
  assert.equal((await notMinable(rs.tx.toHex())).mined, false, 'a SCRIPT note via the KEY leaf must be rejected (owner_type_in arm gate)');
  console.log('  RED owner_type_in≠KEY (SCRIPT note via KEY leaf): rejected at block-validation');

  // RED bad-sig
  const t = buildSpend(txp, { children, mutate: (w) => { w[3 + 4 * Mp] = Buffer.alloc(64, 0x00); } }); // sig @ Wk = 3+4*Mp
  t.tx.ins[0].witness = [...t.w, cov.leaf, cov.controlBlock];
  assert.equal((await notMinable(t.tx.toHex())).mined, false, 'bad signature rejected');
  console.log('  RED bad-sig: rejected at block-validation');
  console.log('\n✅ P2-0 v2 leaf at CONSENSUS: 66B owner_type state + the owner_type arm gate enforced with real Schnorr.\n');
});
