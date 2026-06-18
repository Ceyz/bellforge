// FULL N9 LEAF scriptsim test (no node) — OP_IF(genesis | continuation) + shared epilogue. The GENESIS spend proves the
// note's parent is the 2-input mint (template-pinned); the CONTINUATION spend proves the txGP lineage. Run: node --test p1e3_n9.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, tapLeafHash } from '../canaries/tap.mjs';
import { sighashComponents, reassembleSighash, u64, u32, varslice } from './sighashParts.mjs';
import { encodeState, tokenId } from './wire.mjs';
import { PRELEN_CONT, VOUT0_LE } from './p1e3Const.mjs';
import { p1e3FullOps, buildP1e3FullScript } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const stateSpk = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);
const out = (value, script) => ({ value, script });

// genesis params (operator-set)
const gTxid = S(B(0x99));                              // the genesis-input txid (internal)
const G = tokenId({ genesisTxidInternal: gTxid, genesisVout: 0 });
const AMOUNT_0 = 21_000_000n, VALUE_0 = 100000n, F = 50000n;
const feeSPK = p2wpkh(0xe1);
const feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
const operatorPriv = Buffer.alloc(32, 0x0b);
const operatorP = Buffer.from(ecc.pointFromScalar(operatorPriv, true)).subarray(1);
const OWNER_0 = H160(operatorP);
const CONSTS = { tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 };

function cov() { return makeCovenantRaw(buildP1e3FullScript(CONSTS)); }

// GENESIS spend: parent = the 2-input mint tx; the operator does the first transfer.
function buildGenesis({ wrongAmount0 = null } = {}) {
  const c = cov(); const ownSPK = c.output; const leafHash = tapLeafHash(c.leaf);
  // --- mint tx (parent txP) ---
  const M = Buffer.concat([S(B(0x11)), VOUT0_LE]);                  // minter UTXO outpoint (M at vout 0)
  const changeSPKgen = p2tr(0x44), changeValGen = 12345;
  const mint = new bells.Transaction(); mint.version = 2;
  mint.addInput(M.subarray(0, 32), 0, 0xffffffff);                  // vin0 = M
  mint.addInput(gTxid, 0, 0xffffffff);                             // vin1 = G
  mint.addOutput(ownSPK, Number(VALUE_0));                          // out0 tokenNote0
  mint.addOutput(stateSpk(G, wrongAmount0 ?? AMOUNT_0, OWNER_0), 0);// out1 stateOut0
  mint.addOutput(feeSPK, Number(F));                               // out2 feeOut
  mint.addOutput(changeSPKgen, changeValGen);                      // out3 change
  const mintBuf = mint.toBuffer();
  const committedTxidP = hash256(mintBuf);

  // --- current tx (first transfer of the genesis note), signed by the operator ---
  const out0Value = 50000, changeValue = Number(VALUE_0) - out0Value - 10000;
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const outOwner = Buffer.alloc(20, 0x77), changeSPK = p2tr(0x33);
  const outs = [out(out0Value, ownSPK), out(0, stateSpk(G, AMOUNT_0, outOwner)), out(changeValue, changeSPK)];
  const cur = new bells.Transaction(); cur.version = 2;
  cur.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) cur.addOutput(o.script, o.value);
  const parts = sighashComponents({ inputs: [{ txid: txidDisplay, vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = cur.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, operatorPriv));

  // witness deepest->top: [idx 0..15] + [changeSPK_gen(16), changeValue_gen(17), M_outpoint(18), selector(19)=0x01]
  const witness = [
    sig, operatorP, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(AMOUNT_0), u64(out0Value), ownSPK, committedTxidP, OWNER_0,
    changeSPKgen, u64(changeValGen), M, B(0x01),
  ];
  return { c, witness, real };
}

// CONTINUATION spend through the same leaf: parent txP is a transfer, grandparent txGP a covenant note.
function buildContinuation() {
  const c = cov(); const ownSPK = c.output; const leafHash = tapLeafHash(c.leaf);
  const ownerPriv = Buffer.alloc(32, 0x3e);
  const P = Buffer.from(ecc.pointFromScalar(ownerPriv, true)).subarray(1);
  const owner_in = H160(P), ownerGP = Buffer.alloc(20, 0x88), amount = AMOUNT_0;
  // grandparent txGP
  const ggTxid = S(B(0x67, 0x67, 0x67));
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(ggTxid, 0, 0xffffffff);
  txGP.addOutput(ownSPK, 1500);
  txGP.addOutput(stateSpk(G, amount, ownerGP), 0);
  txGP.addOutput(p2tr(0x55), 4321);
  const txGPbuf = txGP.toBuffer(); const txGPid = hash256(txGPbuf);
  const tailGP = txGPbuf.subarray(PRELEN_CONT + 43);
  // parent txP (spends txGP.out0)
  const val0P = 1_000_000;
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(txGPid), 0, 0xffffffff);
  txP.addOutput(ownSPK, val0P);
  txP.addOutput(stateSpk(G, amount, owner_in), 0);
  txP.addOutput(p2tr(0x44), 7777);
  const txPbuf = txP.toBuffer(); const committedTxidP = hash256(txPbuf);
  const tailP = txPbuf.subarray(PRELEN_CONT + 43);
  const vin0_outpoint = Buffer.concat([txGPid, VOUT0_LE]);
  // current tx
  const out0Value = 100000, changeValue = val0P - out0Value - 10000;
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const outOwner = Buffer.alloc(20, 0x77), changeSPK = p2tr(0x33);
  const outs = [out(out0Value, ownSPK), out(0, stateSpk(G, amount, outOwner)), out(changeValue, changeSPK)];
  const cur = new bells.Transaction(); cur.version = 2;
  cur.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) cur.addOutput(o.script, o.value);
  const parts = sighashComponents({ inputs: [{ txid: txidDisplay, vout: 0, value: val0P, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = cur.hashForWitnessV1(0, [ownSPK], [val0P], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, ownerPriv));
  // witness deepest->top: [idx 0..18] + [tailGP,vinGP,valGP,ownerGP,amtGP] + gpSelector(empty=transfer-gp) + txPselector(empty=continuation)
  const witness = [
    sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(amount), u64(out0Value), ownSPK, committedTxidP, owner_in,
    tailP, vin0_outpoint, u64(val0P),
    tailGP, Buffer.concat([ggTxid, VOUT0_LE]), u64(1500), ownerGP, u64(amount),
    Buffer.alloc(0),  // gpSelector = empty = transfer-grandparent (ELSE)
    Buffer.alloc(0),  // txPselector = empty = continuation (ELSE)
  ];
  return { c, witness, real };
}

// DEPTH-3 chain: mint -> transfer#1(genesis) -> transfer#2(continuation w/ MINT grandparent). This is the case the audit
// found FROZEN before the dual-shape fix (N1's grandparent IS the 2-input mint, not a mono-input transfer).
function buildDepth3() {
  const c = cov(); const ownSPK = c.output; const leafHash = tapLeafHash(c.leaf);
  const M = Buffer.concat([S(B(0x11)), VOUT0_LE]);
  const mintChangeSPK = p2tr(0x44), mintChangeVal = 12345;
  const mint = new bells.Transaction(); mint.version = 2;
  mint.addInput(M.subarray(0, 32), 0, 0xffffffff);
  mint.addInput(gTxid, 0, 0xffffffff);
  mint.addOutput(ownSPK, Number(VALUE_0));                          // out0 = G0 (the genesis note)
  mint.addOutput(stateSpk(G, AMOUNT_0, OWNER_0), 0);
  mint.addOutput(feeSPK, Number(F));
  mint.addOutput(mintChangeSPK, mintChangeVal);
  const mintTxid = hash256(mint.toBuffer());
  // transfer#1 spends G0 (the genesis note) -> N1
  const V1 = 80000;
  const t1OwnerPriv = Buffer.alloc(32, 0x21);
  const P1 = Buffer.from(ecc.pointFromScalar(t1OwnerPriv, true)).subarray(1);
  const owner1 = H160(P1);
  const t1 = new bells.Transaction(); t1.version = 2;
  t1.addInput(Buffer.from(mintTxid), 0, 0xffffffff);                // spends mint.out0 = G0
  t1.addOutput(ownSPK, V1);                                         // out0 = N1
  t1.addOutput(stateSpk(G, AMOUNT_0, owner1), 0);
  t1.addOutput(p2tr(0x55), Number(VALUE_0) - V1 - 10000);
  const t1Buf = t1.toBuffer(); const t1Txid = hash256(t1Buf);
  const tailP1 = t1Buf.subarray(PRELEN_CONT + 43);
  const vin0_outpoint = Buffer.concat([mintTxid, VOUT0_LE]);        // transfer#1.vin0 = (mint, 0) = the MINT outpoint
  // transfer#2 spends N1 -> continuation arm, MINT grandparent
  const out0Value2 = 40000, changeVal2 = V1 - out0Value2 - 10000;
  const t2idDisplay = Buffer.from(t1Txid).reverse().toString('hex');
  const outOwner2 = Buffer.alloc(20, 0x77), changeSPK2 = p2tr(0x33);
  const outs = [out(out0Value2, ownSPK), out(0, stateSpk(G, AMOUNT_0, outOwner2)), out(changeVal2, changeSPK2)];
  const t2 = new bells.Transaction(); t2.version = 2;
  t2.addInput(Buffer.from(t2idDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) t2.addOutput(o.script, o.value);
  const parts = sighashComponents({ inputs: [{ txid: t2idDisplay, vout: 0, value: V1, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = t2.hashForWitnessV1(0, [ownSPK], [V1], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, t1OwnerPriv));      // N1's owner (owner1) signs
  // witness: [idx 0..18] + [changeSPK_gp(19), changeValue_gp(20), M_gp(21)] + gpSelector(0x01=mint) + txPselector(empty=continuation)
  const witness = [
    sig, P1, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK2, u64(changeVal2), outOwner2, u64(AMOUNT_0), u64(out0Value2), ownSPK, t1Txid, owner1,
    tailP1, vin0_outpoint, u64(V1),
    mintChangeSPK, u64(mintChangeVal), M,
    B(0x01), Buffer.alloc(0),
  ];
  return { c, witness, real };
}

test('N9 DEPTH-3 GREEN (the audit lineage-freeze fix): transfer#2 of a note whose grandparent IS the 2-input mint', () => {
  const { witness, real } = buildDepth3();
  const r = runScript(p1e3FullOps(CONSTS), witness, real);
  assert.ok(r.ok, `depth-3 mint-grandparent expected GREEN (was FROZEN before the dual-shape fix); trace=${r.trace.slice(-8)}`);
  console.log('FULL N9 leaf — DEPTH-3 mint-grandparent continuation GREEN (lineage-freeze FIXED)');
});

test('N9 GENESIS spend GREEN: parent is the 2-input mint (template-pinned), operator first transfer', () => {
  const { c, witness, real } = buildGenesis();
  const r = runScript(p1e3FullOps(CONSTS), witness, real);
  assert.ok(r.ok, `genesis expected GREEN; main=${r.main.map((x) => x.toString('hex')).slice(0, 3)} trace=${r.trace.slice(-8)}`);
  console.log(`FULL N9 leaf ${c.leaf.length}B — GENESIS spend GREEN`);
});

test('N9 CONTINUATION spend GREEN: parent is a transfer with a real covenant grandparent', () => {
  const { witness, real } = buildContinuation();
  const r = runScript(p1e3FullOps(CONSTS), witness, real);
  assert.ok(r.ok, `continuation expected GREEN; main=${r.main.map((x) => x.toString('hex')).slice(0, 3)} trace=${r.trace.slice(-8)}`);
  console.log('FULL N9 leaf — CONTINUATION spend GREEN');
});

test('N9 RED genesis with wrong AMOUNT_0: the mint stateOut0 commits a different supply -> reject', () => {
  const { witness, real } = buildGenesis({ wrongAmount0: 99999999n });
  assert.throws(() => runScript(p1e3FullOps(CONSTS), witness, real), /EQUALVERIFY/);
});

test('N9 RED non-minimal OP_IF selector (0x02) -> MINIMALIF reject', () => {
  const base = buildGenesis();
  const w = [...base.witness]; w[w.length - 1] = B(0x02);
  assert.throws(() => runScript(p1e3FullOps(CONSTS), w, base.real), /MINIMALIF/);
});

test('N9 RED MINIMALIF variants 0x00 / 0x80 / 0x0001 -> reject (audit: lock the selector to {empty,0x01})', () => {
  const base = buildGenesis();
  for (const bad of [B(0x00), B(0x80), B(0x00, 0x01)]) {
    const w = [...base.witness]; w[w.length - 1] = bad;
    assert.throws(() => runScript(p1e3FullOps(CONSTS), w, base.real), /MINIMALIF/, `selector ${bad.toString('hex')} must reject`);
  }
});

// FORGED-GENESIS (the headline anti-inflation canary): an attacker authors a 1-input parent (pays the covenant addr + a fat
// stateOut, NO real mint) and tries to spend the note via the GENESIS arm. The genesis arm rebuilds the 2-input mint
// TEMPLATE, whose hash can never equal the 1-input authored parent's txid -> EQUALVERIFY(committedTxidP) reject.
test('N9 RED forged-genesis: a 1-input authored parent presented to the GENESIS arm -> reject (mint-from-nothing)', () => {
  const c = cov(); const ownSPK = c.output; const leafHash = tapLeafHash(c.leaf);
  // attacker's authored 1-input parent: out0=note(VALUE_0,ownSPK), out1=stateOut(AMOUNT_0,OWNER_0), out2=change
  const authored = new bells.Transaction(); authored.version = 2;
  authored.addInput(S(B(0xde, 0xad)), 0, 0xffffffff);
  authored.addOutput(ownSPK, Number(VALUE_0));
  authored.addOutput(stateSpk(G, AMOUNT_0, OWNER_0), 0);
  authored.addOutput(p2tr(0x44), 9999);
  const committedTxidP = hash256(authored.toBuffer());   // hash256 of a 1-INPUT tx
  // spend the note via the genesis arm; the genesis 2-input template reconstruction can't match committedTxidP
  const out0Value = 50000, changeValue = Number(VALUE_0) - out0Value - 10000;
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const outs = [out(out0Value, ownSPK), out(0, stateSpk(G, AMOUNT_0, Buffer.alloc(20, 0x77))), out(changeValue, p2tr(0x33))];
  const cur = new bells.Transaction(); cur.version = 2;
  cur.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) cur.addOutput(o.script, o.value);
  const parts = sighashComponents({ inputs: [{ txid: txidDisplay, vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = cur.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, operatorPriv));
  const M = Buffer.concat([S(B(0x11)), VOUT0_LE]);
  const w = [
    sig, operatorP, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    p2tr(0x33), u64(changeValue), Buffer.alloc(20, 0x77), u64(AMOUNT_0), u64(out0Value), ownSPK, committedTxidP, OWNER_0,
    p2tr(0x44), u64(9999), M, B(0x01),
  ];
  assert.throws(() => runScript(p1e3FullOps(CONSTS), w, real), /EQUALVERIFY/);
});

test('N9 RED changeOut shape (audit): a non-34B change scriptPubKey in the current tx -> sizePin reject', () => {
  // rebuild a genesis spend but feed a P2WPKH (22B) changeSPK at idx 8 — the epilogue sizePin(34) must reject.
  const base = buildGenesis();
  const w = [...base.witness]; w[8] = p2wpkh(0x33); // 22B instead of 34B
  assert.throws(() => runScript(p1e3FullOps(CONSTS), w, base.real), /EQUALVERIFY/);
});

// GPT round-10 (OP_PICK maintenance safety net — KEEP PERMANENTLY): the leaf has NO explicit witness-item-COUNT check;
// pick-depth correctness rests transitively on per-arm size pins + the clean-stack rule + the reconstruction hash. These
// REDs lock that property so a future manual refactor can't silently break it.
// rejection happens via EITHER a clean-stack `ok=false` OR a throw (EQUALVERIFY/MINIMALIF) — both are valid rejects.
const rejects = (ops, w, real) => { try { return !runScript(ops, w, real).ok; } catch { return true; } };

test('N9 RED dirty-stack: an extra witness item at the deepest position -> reject (residue / clean-stack)', () => {
  const base = buildGenesis();
  assert.ok(rejects(p1e3FullOps(CONSTS), [B(0xff), ...base.witness], base.real), 'an extra bottom witness item must NOT pass');
});

test('N9 RED wrong-arm: continuation-shaped witness fed to the GENESIS branch (selector flipped) -> reject', () => {
  const base = buildContinuation();
  const w = [...base.witness]; w[w.length - 1] = B(0x01); // flip txPselector empty->0x01 (genesis) on a continuation witness
  assert.ok(rejects(p1e3FullOps(CONSTS), w, base.real), 'a continuation witness driven through the genesis arm must reject');
});

test('N9 RED wrong-arm: genesis-shaped witness fed to the CONTINUATION branch (selector flipped) -> reject', () => {
  const base = buildGenesis();
  const w = [...base.witness]; w[w.length - 1] = Buffer.alloc(0); // flip txPselector 0x01->empty (continuation) on a genesis witness
  assert.ok(rejects(p1e3FullOps(CONSTS), w, base.real), 'a genesis witness driven through the continuation arm must reject');
});
