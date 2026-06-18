// R3 CLOSURE — the full token lifecycle at CONSENSUS: the REAL p3 minter COVENANT (which enforces the template on-chain via
// CSFS) produces a genesis note locked by the REAL N9 transfer leaf, and the N9 genesis arm then SPENDS that note. Proves
// the p3 minter and the N9 leaf are byte-compatible (the minter's 4 outputs == the N9 genesis arm's reconstructed template).
// Run (regtest up): node --test p1e3_minter_e2e.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, tapLeafHash, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u64, u32, varslice } from './sighashParts.mjs';
import { encodeState, tokenId } from './wire.mjs';
import { PRELEN_CONT, VOUT0_LE } from './p1e3Const.mjs';
import { buildP3MinterScript, p3MinterOps } from './p3MinterCovenant.mjs';
import { p1e3FullOps, buildP1e3FullScript } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason})`;
if (skip) console.log(`\np1e3 minter e2e SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const B = (...x) => Buffer.from(x);
const O = bells.opcodes;
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const outpointOf = (txid, vout) => Buffer.concat([Buffer.from(txid, 'hex').reverse(), u32(vout)]);
const keyOf = (fill) => { const pr = Buffer.alloc(32, fill); return { pr, P: Buffer.from(ecc.pointFromScalar(pr, true)).subarray(1) }; };
const FEE = 10000;

test('R3: real p3 minter covenant -> genesis note (N9 leaf) -> N9 genesis-arm transfer, all at CONSENSUS', { skip }, async () => {
  // --- genesis input G defines token_id ; operator owns the genesis note ---
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const op = keyOf(0x0b), OWNER_0 = H160(op.P);
  const VALUE_0 = 100000n, AMOUNT_0 = 21_000_000n, F = 50000n;
  const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
  const CONSTS = { tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 };

  // --- the REAL N9 transfer leaf (this is transferSPK) ---
  const cov = makeCovenantRaw(buildP1e3FullScript(CONSTS));
  const ownSPK = cov.output;

  // --- the REAL p3 minter covenant, configured so its 4 outputs == the N9 genesis template ---
  const tokenOut0 = Buffer.concat([u64(VALUE_0), varslice(ownSPK)]);          // out0 = VALUE_0 ‖ 0x22 ‖ ownSPK
  const stateScript0 = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const stateOut0 = Buffer.concat([u64(0n), varslice(stateScript0)]);         // = FRAME ‖ SHA256(state) (the N9 stateOut0)
  const changeSPK = p2tr(0xf1);
  const minterCov = makeCovenantRaw(buildP3MinterScript({ tokenId: G, tokenOut0, stateOut0, feeOut, changeSpkLen: 34 }));
  console.log(`\nN9 leaf ${cov.leaf.length}B ; p3 minter ${minterCov.leaf.length}B ; token_id=${G.toString('hex').slice(0, 16)}…`);

  // --- MINT: spend [minter@M, G] -> [tokenOut0(ownSPK), stateOut0, feeOut, change] (the p3 covenant enforces this) ---
  const mf = await fund(minterCov, 1);
  const mint = new bells.Transaction(); mint.version = 2;
  mint.addInput(Buffer.from(mf.fundTxid, 'hex').reverse(), mf.vout, 0xffffffff);  // vin0 = minter UTXO M
  mint.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);  // vin1 = G
  const mintChangeVal = mf.valueSats + gf.valueSats - Number(VALUE_0) - Number(F) - FEE;
  mint.addOutput(ownSPK, Number(VALUE_0));
  mint.addOutput(stateScript0, 0);
  mint.addOutput(feeSPK, Number(F));
  mint.addOutput(changeSPK, mintChangeVal);
  // minter witness (CSFS binding): c2=SHA256(M‖G) + c6 computed in-script; the rest witness
  const mLeafHash = tapLeafHash(minterCov.leaf);
  const mParts = sighashComponents({
    inputs: [{ txid: mf.fundTxid, vout: mf.vout, value: mf.valueSats, spk: minterCov.output, sequence: 0xffffffff },
      { txid: gf.fundTxid, vout: gf.vout, value: gf.valueSats, spk: opTrue.output, sequence: 0xffffffff }],
    outputs: mint.outs.map((o) => ({ value: o.value, script: o.script })),
  });
  const { pre: mc1, mid: mc7, post: mc9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash: mLeafHash, parts: mParts });
  const mReal = mint.hashForWitnessV1(0, [minterCov.output, opTrue.output], [mf.valueSats, gf.valueSats], bells.Transaction.SIGHASH_DEFAULT, mLeafHash);
  const mk = keyOf(0x5e);
  const mSig = Buffer.from(ecc.signSchnorr(mReal, mk.pr));
  const M = outpointOf(mf.fundTxid, mf.vout);
  const mWitness = [mc1, mParts.shaAmounts, mParts.shaScriptPubKeys, mParts.shaSequences, mc7, mLeafHash, mc9, u64(mintChangeVal), changeSPK, M, mk.P, mSig];
  // dry-run the minter spend in scriptsim before broadcast
  assert.ok(runScript(p3MinterOps({ tokenId: G, tokenOut0, stateOut0, feeOut, changeSpkLen: 34 }), mWitness, mReal).ok, 'minter scriptsim rejected the mint');
  mint.ins[0].witness = [...mWitness, minterCov.leaf, minterCov.controlBlock];
  mint.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  const mintAccepted = await expectAccept(mint.toHex());
  console.log(`real p3 mint confirmed: ${mintAccepted.txid} — genesis note locked by the N9 leaf`);
  const mintTxid = mint.getId();

  // --- N9 GENESIS-ARM transfer of the genesis note (operator signs) ---
  const leafHash = tapLeafHash(cov.leaf);
  const out0Value = 80000, changeValue = Number(VALUE_0) - out0Value - FEE;
  const outOwner = H160(keyOf(0x21).P), tChangeSPK = p2tr(0x33);
  const outs = [{ value: out0Value, script: ownSPK }, { value: 0, script: Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount: AMOUNT_0, owner: outOwner }))]) }, { value: changeValue, script: tChangeSPK }];
  const t = new bells.Transaction(); t.version = 2;
  t.addInput(Buffer.from(mintTxid, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) t.addOutput(o.script, o.value);
  const tParts = sighashComponents({ inputs: [{ txid: mintTxid, vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: tc1, mid: tc7, post: tc9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts: tParts });
  const tReal = t.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const tSig = Buffer.from(ecc.signSchnorr(tReal, op.pr));
  const committedTxidP = Buffer.from(mintTxid, 'hex').reverse();
  const tWitness = [tSig, op.P, tc1, tParts.shaAmounts, tParts.shaSequences, tc7, leafHash, tc9,
    tChangeSPK, u64(changeValue), outOwner, u64(AMOUNT_0), u64(out0Value), ownSPK, committedTxidP, OWNER_0,
    changeSPK, u64(mintChangeVal), M, B(0x01)]; // genesis arm: mint's change + M + selector=0x01
  assert.ok(runScript(p1e3FullOps(CONSTS), tWitness, tReal).ok, 'N9 transfer scriptsim rejected before broadcast');
  t.ins[0].witness = [...tWitness, cov.leaf, cov.controlBlock];
  const tAccepted = await expectAccept(t.toHex());
  assert.ok(tAccepted.confirmations >= 1, 'N9 transfer not confirmed');
  console.log(`N9 genesis-arm transfer of the minted note confirmed: ${tAccepted.txid}`);
  console.log(`\n✅ R3 CLOSED: real p3 minter -> N9 genesis note -> N9 transfer, full lifecycle at CONSENSUS.\n`);
});
