// AUDIT G + I (regtest) — DUST / sat-value liveness, promoted from the A–O audit (docs/AUDIT_AO_2026-06-15.md).
// Proves on-node: a 0/1-sat live KEY token note is CONSENSUS-VALID (generateblock) but RELAY-REJECTED as dust
// (testmempoolaccept), a realistic value relays, and P4 credits the 0-sat note LIVE with satValue 0. With the KEY
// arm being strictly 1-input, such a note is permanently relay-stranded (no fee top-up possible). This is a
// FREEZE-LEVEL finding: leaves pin value to 8B with NO floor. Run (node up): node --test native/dust_liveness_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, fund, expectAccept, tapLeafHash } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { encodeStateV2, OwnerType, tokenId } from './wire.mjs';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitAMonoV2Witness, monoGenesisTx } from './p1e3MonoGenesisV2.mjs';
import { buildTaptree } from './freezeEnumerate.mjs';
import { freezeDeploy } from './p4/deploy.mjs';
import { isSplitTransferShape, splitCandidatesFromWitnessMonoGenesis, splitCreditAmountsV2 } from './p4/splitPredicates.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nDUST liveness regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const outpointOf = (f) => Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32le(f.vout)]);
const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
const feeSPK = p2tr(0x99), feeVal = 100000n, feeOut = Buffer.concat([u64(feeVal), B(0x22), feeSPK]);
const changeSPKgp = p2tr(0x88), curChangeSpk = p2tr(0x77), parChangeSpk = p2tr(0x88);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

test('G: 0/1-sat live KEY notes are consensus-valid but relay-dust-rejected; P4 credits them live with satValue 0', { skip }, async () => {
  const M = 2, priv = Buffer.alloc(32, 0x0b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1), OWNER_0 = H160(P);
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const deploy = freezeDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34, arms: ['key', 'script'] });
  const tree = buildTaptree(deploy.consts, { arms: ['key', 'script'] });
  const ownSPK = tree.transferSPK;
  const leaf = tree.ordered.find((l) => l.id.fam === 'root-split' && l.id.M === M).leaf;
  const controlBlock = tree.controlBlockFor(leaf), leafHash = tapLeafHash(leaf);

  const mgp = await fund(opTrue, 1);
  const changeValGp = mgp.valueSats + gf.valueSats - Number(VALUE_0) - Number(feeVal) - 1000000;
  const { genesisTxid, genesis } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: outpointOf(mgp), changeValGp, changeSPKgp });
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(Buffer.from(mgp.fundTxid, 'hex').reverse(), mgp.vout, 0xffffffff);
  txGP.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  txGP.addOutput(ownSPK, Number(VALUE_0));
  txGP.addOutput(B(0x6a, 0x20, ...S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))), 0);
  txGP.addOutput(feeSPK, Number(feeVal)); txGP.addOutput(changeSPKgp, changeValGp);
  txGP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock]; txGP.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txGP.toHex());

  const buildSplit = (v0) => {
    const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: v0, ownerType: OwnerType.KEY }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.KEY }];
    const tx = new bells.Transaction(); tx.version = 2; tx.addInput(genesisTxid, 0, 0xffffffff);
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
    const changeValue = Number(VALUE_0) - v0 - 40000 - 20000; outs.push({ value: changeValue, script: curChangeSpk });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitAMonoV2Witness({ genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn: AMOUNT_0, N, curChangeSpk, parChangeSpk });
    tx.ins[0].witness = [...w, leaf, controlBlock];
    return tx;
  };

  // testmempoolaccept is a dry run (does not consume the mint note) — sweep values.
  const tma = async (v) => (await rpc('testmempoolaccept', [[buildSplit(v).toHex()]]))[0];
  const r40000 = await tma(40000), r1 = await tma(1), r0 = await tma(0);
  assert.equal(r40000.allowed, true, 'a realistic-value (40000-sat) child relays');
  assert.equal(r1.allowed, false, 'a 1-sat child is relay-rejected'); assert.match(r1['reject-reason'] || '', /dust/);
  assert.equal(r0.allowed, false, 'a 0-sat child is relay-rejected'); assert.match(r0['reject-reason'] || '', /dust/);

  // consensus MINES the 0-sat split (generateblock validates under consensus, not relay policy).
  const zeroTx = buildSplit(0);
  const mineAddr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: 'dev' });
  const blk = await rpc('generateblock', [mineAddr, [zeroTx.toHex()], true], { wallet: 'dev' });
  assert.ok(blk && blk.hash, 'consensus mines the 0-sat split (consensus-valid despite relay dust)');

  // P4 (genesis-mirror) credits the 0-sat note as LIVE — it recognizes the token output by script, sat-blind.
  assert.equal(isSplitTransferShape(zeroTx, ownSPK), true);
  const cands = splitCandidatesFromWitnessMonoGenesis(zeroTx);
  const credited = splitCreditAmountsV2(zeroTx, { tokenId: G, amount: AMOUNT_0, owner: OWNER_0, ownerType: OwnerType.KEY }, cands);
  const child0 = Array.isArray(credited) && credited.find((c) => c.vout === 0);
  assert.equal(Number(zeroTx.outs[0].value), 0, 'child0 tokenOut carries 0 sats');
  assert.ok(child0 && child0.amount === 7_000_000n, 'P4 credits the 0-sat note as a live 7,000,000-token note');
});
