// C-1 DECIDER (regtest, real Schnorr) — promoted from the 2026-06-15 pre-freeze audit (docs/AUDIT_BOUND_PREFREEZE.md).
// Refutes "mint-from-nothing": on a NO-ESCAPE covenant (single covenant leaf = the frozen-tree spend obligation), a fabricated
// note whose PARENT's vin0 is NOT a covenant note is UNSPENDABLE — the grandparent arm forces hash256(covenant-shaped ancestor)
// == txP.vin0, which a real non-covenant outpoint can't satisfy. The depth-2 induction DOES close to genesis here. (The workflow's
// scriptsim "999M mint" was a single-leaf-isolation artifact; the make2Leaf{OP_TRUE,leaf} harness's escape masks it.)
// Run (node up): node --test native/p1e3_c1_noescape_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, OwnerType, encodeAmount, tokenId } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { buildSplitFullLineageSplitGrandparentV2Leaf, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nC-1 no-escape regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const changeSPK = p2tr(0x77), curChangeSpk = p2tr(0x77);
const stateScript = (G, amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

test('C-1: a fabricated non-genesis-rooted note is CREATABLE but UNSPENDABLE on a no-escape covenant (no on-chain inflation)', { skip }, async () => {
  const Mp = 2, j = 0, M = 2, Mp_gp = 2;
  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1), owner_in = H160(P);
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK };                       // CW=false (CW does not affect the grandparent bind being tested)
  const leaf = buildSplitFullLineageSplitGrandparentV2Leaf(Mp, j, M, N, Mp_gp, consts);
  const cov = makeCovenantRaw(leaf);                              // SINGLE-leaf tree => NO OP_TRUE escape (the frozen-tree obligation)
  const ownSPK = cov.output, leafHash = tapLeafHash(leaf);

  // STEP 1: FABRICATE txP — a NORMAL tx (vin0 = the opTrue UTXO, NOT a covenant note) paying a 999M note INTO ownSPK. Mines (free).
  const txpChildren = [{ value: 200000, amount: 999_000_000n, owner: owner_in, ownerType: OwnerType.KEY }, { value: 200000, amount: 1_000_000n, owner: Buffer.alloc(20, 0xc1), ownerType: OwnerType.KEY }];
  const txpChange = gf.valueSats - 400000 - 1000000;
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  txP.addOutput(changeSPK, txpChange);
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];        // spend opTrue => txP is NOT a covenant spend
  await expectAccept(txP.toHex());                                // the fake 999M note is CREATED (paying into a taproot SPK runs no script)

  // STEP 2: try to SPEND the fake note via the no-escape covenant leaf, with the attacker's best-effort fabricated grandparent.
  const children = [{ amount: 500_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 499_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.KEY }];
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime: 0, kids: [{ value: 100000, amount: 999_000_000n, owner: Buffer.alloc(20, 0xd0), ownerType: OwnerType.KEY }, { value: 100000, amount: 1n, owner: Buffer.alloc(20, 0xd1), ownerType: OwnerType.KEY }], changeValGp: 7000 });
  const tx = new bells.Transaction(); tx.version = 2; tx.addInput(committedTxidP, 0, 0xffffffff);
  const outs = [];
  for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
  const changeValue = txpChildren[0].value - 80000 - 20000; outs.push({ value: changeValue, script: curChangeSpk });
  for (const o of outs) tx.addOutput(o.script, o.value);
  const real = tx.hashForWitnessV1(0, [ownSPK], [txpChildren[0].value], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));            // attacker OWNS the fake note (owner_in=hash160(P)) — key-auth is NOT the blocker
  const parts = sighashComponents({ inputs: [{ txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 0, value: txpChildren[0].value, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChange, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: 999_000_000n, N });
  tx.ins[0].witness = [...w, ...gp.pieces, leaf, cov.controlBlock];
  assert.equal((await notMinable(tx.toHex())).mined, false, 'the fabricated 999M note is UNSPENDABLE (grandparent arm: hash256(covenant-shaped GGP)‖0 != txP.vin0) — no on-chain inflation');
});
