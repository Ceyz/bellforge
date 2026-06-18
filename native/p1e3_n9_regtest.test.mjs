// THE GATING CANARY — the full N9 transfer leaf at CONSENSUS on a real bellsd node. Builds a real 3-tx chain
// mint(2-input) -> transfer#1(GENESIS arm) -> transfer#2(CONTINUATION arm, MINT grandparent), each accepted with a REAL
// Schnorr sig. This is the ONLY proof of (a) the on-stack 211B message == bellsd's consensus sighash, (b) CSFS+CHECKSIG
// actually verify, (c) the lineage-freeze fix works at consensus. scriptsim cannot prove any of these.
// Run (regtest up): node --test p1e3_n9_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash, toSats, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u64, u32, varslice } from './sighashParts.mjs';
import { encodeState, tokenId } from './wire.mjs';
import { VOUT0_LE, PRELEN_CONT } from './p1e3Const.mjs';
import { p1e3FullOps, buildP1e3FullScript } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\np1e3 N9 regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const O = bells.opcodes;
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const stateSpk = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);
const outpointOf = (txid, vout) => Buffer.concat([Buffer.from(txid, 'hex').reverse(), u32(vout)]);
const keyOf = (fill) => { const pr = Buffer.alloc(32, fill); return { pr, P: Buffer.from(ecc.pointFromScalar(pr, true)).subarray(1) }; };

// Build a script-path spend of the N9 leaf: mono-input, 3 outputs [tokenOut(out0Value,ownSPK), stateOut(amount,outOwner), change].
// `armWitness` = the arm-specific witness items above idx 0..15 (genesis or continuation) INCLUDING the selector(s).
function spendNote({ cov, ownSPK, fullConsts, noteTxid, noteVout, noteValue, amount, ownerPriv, outOwner, out0Value, fee, armWitness, simCheck, mutate, curOutAmount }) {
  const leafHash = tapLeafHash(cov.leaf);
  const P = Buffer.from(ecc.pointFromScalar(ownerPriv, true)).subarray(1);
  const owner_in = H160(P);
  const changeSPK = p2tr(0x33), changeValue = noteValue - out0Value - fee;
  // the REAL current tx's stateOut commits curOutAmount (default = the conserved `amount`); over-amount REDs set it != amount.
  const outs = [{ value: out0Value, script: ownSPK }, { value: 0, script: stateSpk(fullConsts.tokenId, curOutAmount ?? amount, outOwner) }, { value: changeValue, script: changeSPK }];
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(noteTxid, 'hex').reverse(), noteVout, 0xffffffff);
  for (const o of outs) tx.addOutput(o.script, o.value);
  const legacyBuf = tx.toBuffer(); // LEGACY (no witness yet) — what the covenant reconstructs + hash256s for the txid
  const parts = sighashComponents({ inputs: [{ txid: noteTxid, vout: noteVout, value: noteValue, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [ownSPK], [noteValue], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, ownerPriv));
  const committedTxidP = Buffer.from(noteTxid, 'hex').reverse(); // the note's parent txid (internal)
  // idx 0..15:
  const head = [sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(amount), u64(out0Value), ownSPK, committedTxidP, owner_in];
  const witnessData = [...head, ...armWitness];
  if (mutate) mutate(witnessData);          // RED tests corrupt the witness AFTER signing (the corruption is the attack)
  if (simCheck) {
    const r = runScript(p1e3FullOps(fullConsts), witnessData, real);
    assert.ok(r.ok, `scriptsim rejected the spend before broadcast: trace=${r.trace.slice(-6)}`);
  }
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return { hex: tx.toHex(), txid: tx.getId(), tailP: legacyBuf.subarray(PRELEN_CONT + 43), out0Value };
}

test('N9 GATING CANARY: real mint -> transfer#1(genesis) -> transfer#2(continuation) all accepted at CONSENSUS', { skip }, async () => {
  // --- genesis input G (OP_TRUE) defines token_id ---
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const op = keyOf(0x0b); const OWNER_0 = H160(op.P);          // operator owns the genesis note
  const VALUE_0 = 100000n, AMOUNT_0 = 21_000_000n, F = 50000n;
  const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
  const CONSTS = { tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 };
  const cov = makeCovenantRaw(buildP1e3FullScript(CONSTS)); const ownSPK = cov.output;
  console.log(`\nN9 leaf addr ${cov.address} (${cov.leaf.length}B) token_id=${G.toString('hex').slice(0, 16)}…`);

  // --- MINT: 2-input [M(opTrue), G(opTrue)] -> [tokenNote0(VALUE_0,ownSPK), stateOut0, feeOut, change] ---
  const mfund = await fund(opTrue, 1); // M
  const mintChangeSPK = p2tr(0x44);
  const mintChangeVal = mfund.valueSats + gf.valueSats - Number(VALUE_0) - Number(F) - 10000;
  const mint = new bells.Transaction(); mint.version = 2;
  mint.addInput(Buffer.from(mfund.fundTxid, 'hex').reverse(), mfund.vout, 0xffffffff);  // vin0 = M
  mint.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);        // vin1 = G
  mint.addOutput(ownSPK, Number(VALUE_0));               // out0 genesis note
  mint.addOutput(stateSpk(G, AMOUNT_0, OWNER_0), 0);     // out1 stateOut0
  mint.addOutput(feeSPK, Number(F));                     // out2 feeOut
  mint.addOutput(mintChangeSPK, mintChangeVal);          // out3 change
  mint.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  mint.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  const mintAccepted = await expectAccept(mint.toHex());
  console.log(`mint (2-input) confirmed: ${mintAccepted.txid}`);
  const mintTxid = mint.getId();
  const M_outpoint = outpointOf(mfund.fundTxid, mfund.vout);

  // --- TRANSFER#1 via the GENESIS arm (operator signs) ---
  // genesis arm witness above idx0..15: [changeSPK_gen(=mint change), changeValue_gen, M_outpoint, txPselector=0x01]
  const t1 = spendNote({
    cov, ownSPK, fullConsts: CONSTS, noteTxid: mintTxid, noteVout: 0, noteValue: Number(VALUE_0),
    amount: AMOUNT_0, ownerPriv: op.pr, outOwner: H160(keyOf(0x21).P), out0Value: 80000, fee: 10000,
    armWitness: [mintChangeSPK, u64(mintChangeVal), M_outpoint, B(0x01)], simCheck: true,
  });
  const t1Accepted = await expectAccept(t1.hex);
  console.log(`transfer#1 (GENESIS arm) confirmed: ${t1Accepted.txid} — operator-first-transfer accepted at CONSENSUS`);

  // --- TRANSFER#2 via the CONTINUATION arm with the MINT grandparent (N1's owner signs) ---
  // continuation witness above idx0..15: [tailP(=transfer#1 tail), vin0_outpoint(=mint outpoint), tokenOut0val_P(=N1 value),
  //   changeSPK_gp(=mint change), changeValue_gp, M_gp(=mint M), gpSelector=0x01(mint), txPselector=empty]
  const owner1 = keyOf(0x21); // = the recipient of transfer#1 (outOwner above used H160(keyOf(0x21).P))
  const vin0_outpoint = outpointOf(mintTxid, 0); // transfer#1.vin0 = (mint, 0)
  const t2 = spendNote({
    cov, ownSPK, fullConsts: CONSTS, noteTxid: t1.txid, noteVout: 0, noteValue: t1.out0Value,
    amount: AMOUNT_0, ownerPriv: owner1.pr, outOwner: H160(keyOf(0x33).P), out0Value: 40000, fee: 10000,
    armWitness: [t1.tailP, vin0_outpoint, u64(t1.out0Value), mintChangeSPK, u64(mintChangeVal), M_outpoint, B(0x01), Buffer.alloc(0)],
    simCheck: true,
  });
  const t2Accepted = await expectAccept(t2.hex);
  assert.ok(t2Accepted.confirmations >= 1, 'transfer#2 not confirmed');
  console.log(`transfer#2 (CONTINUATION arm, MINT grandparent) confirmed: ${t2Accepted.txid} — the lineage-freeze fix WORKS at CONSENSUS`);
  console.log(`\n✅ N9 end-to-end at CONSENSUS: mint -> transfer#1 -> transfer#2 all accepted with real Schnorr sigs.\n`);
});

// Mint a fresh genesis note and return everything needed to build a GENESIS-arm spend of it.
async function mintGenesisNote() {
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const op = keyOf(0x0b), OWNER_0 = H160(op.P);
  const VALUE_0 = 100000n, AMOUNT_0 = 21_000_000n, F = 50000n;
  const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
  const CONSTS = { tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 };
  const cov = makeCovenantRaw(buildP1e3FullScript(CONSTS)); const ownSPK = cov.output;
  const mfund = await fund(opTrue, 1);
  const mintChangeSPK = p2tr(0x44);
  const mintChangeVal = mfund.valueSats + gf.valueSats - Number(VALUE_0) - Number(F) - 10000;
  const mint = new bells.Transaction(); mint.version = 2;
  mint.addInput(Buffer.from(mfund.fundTxid, 'hex').reverse(), mfund.vout, 0xffffffff);
  mint.addInput(Buffer.from(gf.fundTxid, 'hex').reverse(), gf.vout, 0xffffffff);
  mint.addOutput(ownSPK, Number(VALUE_0));
  mint.addOutput(stateSpk(G, AMOUNT_0, OWNER_0), 0);
  mint.addOutput(feeSPK, Number(F));
  mint.addOutput(mintChangeSPK, mintChangeVal);
  mint.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  mint.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(mint.toHex());
  return { cov, ownSPK, CONSTS, AMOUNT_0, VALUE_0, op, mintTxid: mint.getId(),
    armWitness: [mintChangeSPK, u64(mintChangeVal), outpointOf(mfund.fundTxid, mfund.vout), B(0x01)] };
}

test('N9 CONSENSUS REDs: BIP-342 non-32B-P / 65B-sig / non-minimal selector each rejected at block-validation', { skip }, async () => {
  const g = await mintGenesisNote();
  const base = { cov: g.cov, ownSPK: g.ownSPK, fullConsts: g.CONSTS, noteTxid: g.mintTxid, noteVout: 0,
    noteValue: Number(g.VALUE_0), amount: g.AMOUNT_0, ownerPriv: g.op.pr, outOwner: H160(keyOf(0x21).P), out0Value: 80000, fee: 10000 };

  // RED 1 — non-32B P (BIP-342 unknown-pubkey bypass): if the |P|==32 pin were dropped, a 33-byte P would make
  // CHECKSIG/CSFS SUCCEED WITHOUT VERIFYING and the spend would MINE (anyone-can-spend, consensus-valid). scriptsim
  // CANNOT prove this — only a real node can. notMinable must return mined:false.
  const r33 = await notMinable(spendNote({ ...base, armWitness: g.armWitness, mutate: (w) => { w[1] = Buffer.concat([w[1], B(0x00)]); } }).hex);
  assert.equal(r33.mined, false, `33-byte P MUST be rejected at CONSENSUS (|P|==32 pin): ${r33.error ?? ''}`);
  console.log('N9 non-32B P rejected at CONSENSUS ✓ (BIP-342 bypass closed)');

  // RED 2 — 65-byte sig (explicit-sighash-byte variant): the |sig|==64 pin must reject at consensus.
  const r65 = await notMinable(spendNote({ ...base, armWitness: g.armWitness, mutate: (w) => { w[0] = Buffer.concat([w[0], B(0x01)]); } }).hex);
  assert.equal(r65.mined, false, `65-byte sig MUST be rejected at CONSENSUS (|sig|==64 pin): ${r65.error ?? ''}`);
  console.log('N9 65-byte sig rejected at CONSENSUS ✓');

  // RED 3 — non-minimal OP_IF selector (0x02): MINIMALIF is a CONSENSUS gate (scriptsim models it, but only the node proves it).
  const rmif = await notMinable(spendNote({ ...base, armWitness: [...g.armWitness.slice(0, 3), B(0x02)] }).hex);
  assert.equal(rmif.mined, false, `non-minimal selector MUST be rejected at CONSENSUS (MINIMALIF): ${rmif.error ?? ''}`);
  console.log('N9 non-minimal selector rejected at CONSENSUS ✓ (MINIMALIF)');
});

test('N9 CONSENSUS REDs: over-amount (conservation) / thief (owner-auth) / needle |out0Value|!=8 each rejected at block-validation', { skip }, async () => {
  const g = await mintGenesisNote();
  const base = { cov: g.cov, ownSPK: g.ownSPK, fullConsts: g.CONSTS, noteTxid: g.mintTxid, noteVout: 0,
    noteValue: Number(g.VALUE_0), amount: g.AMOUNT_0, outOwner: H160(keyOf(0x21).P), out0Value: 80000, fee: 10000 };

  // RED over-amount: the real current-tx stateOut commits AMOUNT_0+1 while the covenant rebuilds c6 from amount_in=AMOUNT_0
  // -> computed sha_outputs != real -> the one (sig,P) cannot satisfy CSFS(computed)+CHECKSIG(real) -> consensus reject.
  const rOver = await notMinable(spendNote({ ...base, ownerPriv: g.op.pr, armWitness: g.armWitness, curOutAmount: g.AMOUNT_0 + 1n }).hex);
  assert.equal(rOver.mined, false, `over-amount (inflation) MUST be rejected at CONSENSUS: ${rOver.error ?? ''}`);
  console.log('N9 over-amount (conservation) rejected at CONSENSUS ✓ — the anti-inflation core holds on-node');

  // RED thief: a non-operator signs; the genesis arm forces owner_in==OWNER_0, so we keep owner_in=OWNER_0 (mutate) but
  // present a thief P+sig -> the epilogue owner-auth hash160(thiefP)==owner_in fails.
  const thief = keyOf(0x99);
  const rThief = await notMinable(spendNote({ ...base, ownerPriv: thief.pr, armWitness: g.armWitness,
    mutate: (w) => { w[15] = g.CONSTS.OWNER_0; } }).hex);
  assert.equal(rThief.mined, false, `thief (wrong key) MUST be rejected at CONSENSUS (owner-auth): ${rThief.error ?? ''}`);
  console.log('N9 thief wrong-key rejected at CONSENSUS ✓ (owner-auth)');

  // RED needle: out0Value is not 8 bytes (the C1 boundary-slide class) -> the |out0Value|==8 pin rejects.
  const rNeedle = await notMinable(spendNote({ ...base, ownerPriv: g.op.pr, armWitness: g.armWitness,
    mutate: (w) => { w[12] = Buffer.alloc(7, 0x11); } }).hex);
  assert.equal(rNeedle.mined, false, `non-8B out0Value MUST be rejected at CONSENSUS (C1 |out0Value|==8): ${rNeedle.error ?? ''}`);
  console.log('N9 needle |out0Value|!=8 rejected at CONSENSUS ✓ (C1 pin)');
});

test('N9 CONSENSUS RED: forged-genesis — a 1-input authored parent presented to the GENESIS arm is rejected at block-validation', { skip }, async () => {
  const g = await mintGenesisNote();   // gives us a real covenant (G/consts) + ownSPK
  // attacker authors a 1-INPUT tx that MIMICS the mint template (pays ownSPK + stateOut0 + feeOut + change) but is NOT the
  // 2-input mint that consumed G. The genesis arm rebuilds the 2-input template, whose hash can never equal this 1-input
  // tx's txid -> EQUALVERIFY(committedTxidP) reject. (No real G consumed -> no mint-from-nothing.)
  const opTrue = makeCovenant([O.OP_TRUE]);
  const af = await fund(opTrue, 1);
  const feeSPK = p2wpkh(0xe1), F = 50000n;
  const authored = new bells.Transaction(); authored.version = 2;
  authored.addInput(Buffer.from(af.fundTxid, 'hex').reverse(), af.vout, 0xffffffff);   // ONE input (not [M,G])
  authored.addOutput(g.ownSPK, Number(g.VALUE_0));
  authored.addOutput(stateSpk(g.CONSTS.tokenId, g.AMOUNT_0, g.CONSTS.OWNER_0), 0);
  authored.addOutput(feeSPK, Number(F));
  authored.addOutput(p2tr(0x44), af.valueSats - Number(g.VALUE_0) - Number(F) - 10000);
  authored.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(authored.toHex());
  const authoredTxid = authored.getId();
  // spend authored.out0 via the GENESIS arm with a (arbitrary) M + change; the 2-input template reconstruction won't match.
  const M = Buffer.concat([S(B(0x11)), VOUT0_LE]);
  const forged = spendNote({
    cov: g.cov, ownSPK: g.ownSPK, fullConsts: g.CONSTS, noteTxid: authoredTxid, noteVout: 0, noteValue: Number(g.VALUE_0),
    amount: g.AMOUNT_0, ownerPriv: g.op.pr, outOwner: H160(keyOf(0x21).P), out0Value: 80000, fee: 10000,
    armWitness: [p2tr(0x44), u64(af.valueSats - Number(g.VALUE_0) - Number(F) - 10000), M, B(0x01)],
  });
  const r = await notMinable(forged.hex);
  assert.equal(r.mined, false, `forged-genesis (1-input authored parent) MUST be rejected at CONSENSUS: ${r.error ?? ''}`);
  console.log('N9 forged-genesis (mint-from-nothing) rejected at CONSENSUS ✓ — anti-inflation root holds on-node');
});

test('N9 CONSENSUS RED: multi-input transfer (mono-input freeze) rejected at block-validation', { skip }, async () => {
  // The mono-input fee model: c2 = SHA256(committedTxidP‖0x00000000) is a SINGLE outpoint. Adding a 2nd (fee) input makes
  // the REAL shaPrevouts = SHA256(noteOutpoint ‖ feeOutpoint), which the covenant's single-outpoint c2 can't equal ->
  // CSFS(computed)+CHECKSIG(real) can't both pass -> reject. scriptsim ALWAYS uses 1 input, so only a node proves this.
  const g = await mintGenesisNote();
  const opTrue = makeCovenant([O.OP_TRUE]);
  const ff = await fund(opTrue, 1);                                   // a 2nd (fee) UTXO
  const leafHash = tapLeafHash(g.cov.leaf);
  const out0Value = 80000, changeValue = Number(g.VALUE_0) + ff.valueSats - out0Value - 10000;
  const outs = [{ value: out0Value, script: g.ownSPK }, { value: 0, script: stateSpk(g.CONSTS.tokenId, g.AMOUNT_0, H160(keyOf(0x21).P)) }, { value: changeValue, script: p2tr(0x33) }];
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(g.mintTxid, 'hex').reverse(), 0, 0xffffffff);     // vin0 = the note
  tx.addInput(Buffer.from(ff.fundTxid, 'hex').reverse(), ff.vout, 0xffffffff); // vin1 = fee UTXO (the attack)
  for (const o of outs) tx.addOutput(o.script, o.value);
  const inSpks = [g.ownSPK, opTrue.output], inVals = [Number(g.VALUE_0), ff.valueSats];
  const parts = sighashComponents({
    inputs: [{ txid: g.mintTxid, vout: 0, value: Number(g.VALUE_0), spk: g.ownSPK, sequence: 0xffffffff },
      { txid: ff.fundTxid, vout: ff.vout, value: ff.valueSats, spk: opTrue.output, sequence: 0xffffffff }],
    outputs: outs,
  });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, inSpks, inVals, bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const P = g.op.P, sig = Buffer.from(ecc.signSchnorr(real, g.op.pr));
  const committedTxidP = Buffer.from(g.mintTxid, 'hex').reverse();
  const head = [sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    p2tr(0x33), u64(changeValue), H160(keyOf(0x21).P), u64(g.AMOUNT_0), u64(out0Value), g.ownSPK, committedTxidP, g.CONSTS.OWNER_0];
  tx.ins[0].witness = [...head, ...g.armWitness, g.cov.leaf, g.cov.controlBlock];
  tx.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  const r = await notMinable(tx.toHex());
  assert.equal(r.mined, false, `multi-input transfer MUST be rejected at CONSENSUS (c2 single-outpoint vs real 2-outpoint shaPrevouts): ${r.error ?? ''}`);
  console.log('N9 multi-input transfer rejected at CONSENSUS ✓ (mono-input freeze; the note self-funds its fee)');
});
