// P2-5 LINEAGE v2 at CONSENSUS (Step 8, 6a level — the composed leaf MINUS grandparent) with REAL Schnorr. This proves what
// scriptsim CANNOT: the on-stack position-aware c2 = SHA256(committedTxidP ‖ u32le(2j)) + the M-way c6 == bellsd's consensus
// tapscript sighash (else CSFS/CHECKSIG fail), and amount_in/owner_in are the REAL split-parent's. Chain: build a split-shaped
// txP (its input a plain OP_TRUE UTXO; its OUTPUTS = M' children at the covenant ownSPK), then SPEND child j @ vout 2j via the
// lineage-v2 leaf. The leaf reconstructs txP from witness pieces, backtrace-proves amount_in/owner_in from stateOut_j, welds the
// conservation target to it, and binds the real sighash. Run (regtest up): node --test native/p1e3_split_lineage_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { splitFullLineageOps, buildSplitFullLineageLeaf, splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 lineage-v2 regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const stateScript = (G, amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77);

test('P2-5 LINEAGE v2 (6a) at CONSENSUS: spend a split-child note → 2 children, real Schnorr; c2 position-aware + Σ==backtrace amount_in', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  // G = a real consumed genesis outpoint (OP_TRUE mini; no lineage in 6a). The lineage-v2 leaf (no grandparent) under test.
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const cov = makeCovenantRaw(buildSplitFullLineageLeaf(Mp, j, M, N, { tokenId: G, changeSPK }));
  const ownSPK = cov.output;
  console.log(`\nP2-5 lineage-v2 (6a) leaf ${cov.address} (${cov.leaf.length}B)`);

  // ---- build txP: a split-shaped tx whose INPUT is a plain OP_TRUE UTXO and whose OUTPUTS are M'=2 children at ownSPK + change.
  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);
  const txpChildren = [
    { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xc0) },
    { value: 300000, amount: 14_000_000n, owner: owner_in },           // child j=1 — the note we will spend
  ];
  const n0 = await fund(opTrue, 5);                                     // txP's input (5 BEL)
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(n0.fundTxid, 'hex').reverse(), n0.vout, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner), 0); }
  const txpChangeVal = n0.valueSats - 400000 - 1000000;                // leftover after the 4 outputs + a generous miner fee
  txP.addOutput(changeSPK, txpChangeVal);
  const txPLegacy = txP.toBuffer();                                    // BEFORE the witness (the txid preimage)
  const committedTxidP = hash256(txPLegacy);
  const vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  const txpTxid = await rpc('sendrawtransaction', [txP.toHex()]);
  await rpc('generatetoaddress', [1, n0.mineAddr], { wallet: WALLET });
  assert.ok(Buffer.from(txpTxid, 'hex').reverse().equals(committedTxidP), 'node txid == hash256(my txP legacy) — byte-exact split parent');
  console.log(`  txP (split parent, child j=${j} @ vout ${2 * j}) ${txpTxid}`);

  // ---- spend child j (txP.tokenOut_j @ vout 2j) → 2 new children + change, via the lineage-v2 leaf with real Schnorr.
  const note = { valueSats: txpChildren[j].value };
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const changeValue = note.valueSats - 80000 - 20000;

  const buildSpend = ({ children, amountInOverride, mutate }) => {
    const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : children.reduce((a, c) => a + c.amount, 0n);
    const leafHash = tapLeafHash(cov.leaf);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(committedTxidP, 2 * j, 0xffffffff);                    // committedTxidP is internal byte order (= the outpoint txid)
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner) }); }
    outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const txidHex = Buffer.from(committedTxidP).reverse().toString('hex');
    const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitFullLineageWitness({
      parent: { committedTxidP, vin0Outpoint, changeVal: txpChangeVal, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) },
      epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
      ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount })), amountIn, N,
    });
    if (mutate) mutate(w);
    return { tx, w, real };
  };

  // GREEN — scriptsim pre-check then broadcast.
  const g = buildSpend({ children });
  assert.equal(runScript(splitFullLineageOps(Mp, j, M, N, { tokenId: G, changeSPK }).ops, g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  g.tx.ins[0].witness = [...g.w, cov.leaf, cov.controlBlock];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'lineage-v2 split-child spend not confirmed');
  console.log(`  GREEN: spent child ${j} (14M) -> [5M, 9M] confirmed ${acc.txid} — c2=SHA256(committedTxidP‖${2 * j}), Σ==backtrace amount_in`);

  // RED — INFLATION: children sum to 14M+1 while the backtrace-proven amount_in is 14M.
  const inflated = [{ amount: 5_000_001n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const r = buildSpend({ children: inflated, amountInOverride: 14_000_000n });
  r.tx.ins[0].witness = [...r.w, cov.leaf, cov.controlBlock];
  assert.equal((await notMinable(r.tx.toHex())).mined, false, 'Σ children > backtrace amount_in must be rejected at block-validation');
  console.log('  RED inflation (Σ children > backtrace-proven amount_in): rejected at block-validation');

  // RED — BAD SIG: corrupt the owner-auth/CHECKSIG signature.
  const t = buildSpend({ children, mutate: (w) => { w[3 + 3 * Mp + 0] = Buffer.alloc(64, 0x00); } }); // sig is at epi abs 0 = Wk+0
  t.tx.ins[0].witness = [...t.w, cov.leaf, cov.controlBlock];
  assert.equal((await notMinable(t.tx.toHex())).mined, false, 'a bad signature must be rejected (owner-auth + CHECKSIG)');
  console.log('  RED bad-sig: rejected at block-validation');
  console.log('\n✅ P2-5 LINEAGE v2 (6a) at CONSENSUS: position-aware c2 + conservation-against-backtrace-amount_in enforced with real Schnorr.\n');
});
