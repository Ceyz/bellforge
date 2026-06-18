// P2-0 FREEZE — the ROOT family (split-a-mono) at CONSENSUS, real Schnorr. The highest-stakes leaf: it spends the MINT note (the
// whole supply). Mints a v2 genesis on-node, then spends the mint note DIRECTLY via split-a-mono (the genesis-as-immediate-parent
// kernel reconstructs the 2-input mint byte-exact + c2 binds genesis vout0 + parks AMOUNT_0/OWNER_0/KEY) → M children, Σ==AMOUNT_0,
// signed by the genesis owner key (hash160(P)==OWNER_0). RED inflation + RED wrong-owner reject at block-validation.
// Run (node up): node --test native/p1e3_split_a_mono_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, notMinable, tapLeafHash, NUMS, REGTEST } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, OwnerType } from './wire.mjs';
import { u64 } from './sighashParts.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitAMonoV2Ops, buildSplitAMonoV2Leaf, splitAMonoV2Witness, monoGenesisTx } from './p1e3MonoGenesisV2.mjs';
import { tokenId } from './wire.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 split-a-mono ROOT regtest SKIPPED — ${skip}\n`);

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

function make2Leaf(a, b) {
  const scriptTree = [{ output: a }, { output: b }];
  const mk = (leaf) => bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: REGTEST });
  const pA = mk(a), pB = mk(b);
  if (!pA.output.equals(pB.output)) throw new Error('taptree diverge');
  return { output: pA.output, cbA: pA.witness[pA.witness.length - 1], cbB: pB.witness[pB.witness.length - 1] };
}

test('P2-0 split-a-mono ROOT at CONSENSUS: mint(v2) → spend the MINT note → M children, real Schnorr; the whole supply divides', { skip }, async () => {
  const M = 2;
  const priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const OWNER_0 = H160(P);                                                  // the mint note is KEY-owned by the genesis owner key

  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
  const leaf = buildSplitAMonoV2Leaf(M, N, consts);
  const tt = make2Leaf(opTrue.leaf, leaf);
  const ownSPK = tt.output;
  console.log(`\nP2-0 split-a-mono ROOT leaf M=${M} (${leaf.length}B), covenant ${ownSPK.toString('hex').slice(0, 12)}…`);

  // txGP = the v2 genesis mint (2-input: minter @ vin0, G @ vin1). out0 = the MINT note @ ownSPK, KEY-owned by OWNER_0, amount AMOUNT_0.
  const mgp = await fund(opTrue, 1);
  const mintOutpoint = outpointOf(mgp);
  const changeValGp = mgp.valueSats + gf.valueSats - Number(VALUE_0) - Number(feeVal) - 1000000;
  const { tx: genBytes, genesisTxid, genesis } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeValGp, changeSPKgp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal));
  txGP.addOutput(changeSPKgp, changeValGp);
  assert.ok(txGP.toBuffer().equals(genBytes), 'on-node mint == monoGenesisTx reconstruction (byte-exact)');
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());
  console.log(`  v2 mint ${Buffer.from(genesisTxid).reverse().toString('hex')} (mint note @ vout0)`);

  // SPEND the mint note (genesisTxid @ vout0) via split-a-mono → M children, Σ==AMOUNT_0 (a key→script deposit on the very first split).
  const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const leafHash = tapLeafHash(leaf);
  const buildSpend = ({ owner = priv, infl = 0n } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(genesisTxid, 0, 0xffffffff);                                // vin0 = the mint note @ vout0
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, infl && c === children[1] ? c.amount + infl : c.amount, c.owner, c.ownerType) }); }
    const changeValue = Number(VALUE_0) - 80000 - 20000; outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, owner));
    const Pw = Buffer.from(ecc.pointFromScalar(owner, true)).subarray(1);
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const outsW = children.map((c) => ({ owner: c.owner, value: c.satValue, amount: infl && c === children[1] ? c.amount + infl : c.amount, ownerType: c.ownerType }));
    const w = splitAMonoV2Witness({ genesis, epi: { sig, P: Pw, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: outsW, amountIn: AMOUNT_0, N });
    return { tx, w, real };
  };

  // GREEN — the genesis owner splits the whole supply.
  const g = buildSpend();
  assert.equal(runScript(splitAMonoV2Ops(M, N, consts).ops, g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  g.tx.ins[0].witness = [...g.w, leaf, tt.cbB];
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'split-a-mono not confirmed');
  console.log(`  GREEN: the MINT note split → [7M KEY, 14M SCRIPT] confirmed ${acc.txid} — the whole supply divided at the root`);

  // RED inflation: child amounts sum to AMOUNT_0+1 (conservation welds to the const AMOUNT_0; there is NO witness amount_in).
  const r1 = buildSpend({ infl: 1n });
  r1.tx.ins[0].witness = [...r1.w, leaf, tt.cbB];
  assert.equal((await notMinable(r1.tx.toHex())).mined, false, 'inflated split-a-mono rejected at block-validation');
  console.log('  RED inflation (Σ != AMOUNT_0): rejected at block-validation');

  // RED wrong-owner: a signer whose hash160(P) != OWNER_0 (the parked const) — only the genesis owner can do the first split.
  const r2 = buildSpend({ owner: Buffer.alloc(32, 0x0e) });
  r2.tx.ins[0].witness = [...r2.w, leaf, tt.cbB];
  assert.equal((await notMinable(r2.tx.toHex())).mined, false, 'a non-OWNER_0 signer rejected at block-validation');
  console.log('  RED wrong-owner (hash160(P) != OWNER_0): rejected at block-validation');

  console.log('\n✅ P2-0 split-a-mono ROOT at CONSENSUS: the mint note (whole supply) divides via the genesis kernel, real Schnorr.\n');
});
