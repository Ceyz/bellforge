// MERGE brick 2b (step 1) — the K=2 merge leaf COMPOSITION: two Mp=1 transfer parents reconstructed, a valid 2-input sighash,
// conservation + single-output c6 + 2-input baked-c7 epilogue + KEY-only/single-owner gates. scriptsim. GREEN side0 + side1
// (the two instances of one merge) + REDs (inflation, owner_type≠KEY, position/c7). NOTE: grandparent arms (depth-2 lineage)
// are step 2b-2 — this validates the composition, not lineage soundness (a fabricated parent would pass here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { mergeK2V2Ops, mergeK2V2Witness, mergeK2V2LineageOps, mergeK2V2LineageWitness } from './p1e3MergeK2V2.mjs';
import { transferGrandparentV2 } from './p1e3SplitGrandparentV2.mjs';

const O = bells.opcodes;
const S = bells.crypto.sha256, H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (f) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, f)]);

const tokenId = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId, ownSPK, changeSPK };
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), ownerIn = H160(P);
const leafHash = Buffer.alloc(32, 0x5a);
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId, amount, owner }))]);

// a real degree-1 (1→1 transfer) parent; the spent note is its child @ vout0.
function buildParent(amount, owner, ownerType, seed) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(seed)), 0, 0xffffffff);
  tx.addOutput(ownSPK, 50000);
  tx.addOutput(stateScript(BigInt(amount), owner, ownerType), 0);
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return {
    committedTxidP: hash256(legacy), jValueSats: 50000, amount: BigInt(amount),
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000,
      outputs: [{ value: 50000, amountSer: encodeAmount(BigInt(amount)), owner, ownerType }] },
  };
}

const VALUE_OUT = 40000, CHANGE_VALUE = 15000;

// run one merge instance (side). The tx is fixed (noteA @ vin0, noteB @ vin1); side selects which note is "self".
function run(side, { amtA = 14_000_000n, amtB = 7_000_000n, bOwnerType = OwnerType.KEY, outOverride, sighashSide, wrongOwnSpk } = {}) {
  const A = buildParent(amtA, ownerIn, OwnerType.KEY, 0x42);
  const B_ = buildParent(amtB, ownerIn, bOwnerType, 0x43);
  const self = side === 0 ? A : B_, other = side === 0 ? B_ : A;
  const out = outOverride !== undefined ? BigInt(outOverride) : amtA + amtB;
  const outputs = [
    { value: VALUE_OUT, script: ownSPK },
    { value: 0, script: stateScript(out, ownerIn, OwnerType.KEY) },
    { value: CHANGE_VALUE, script: changeSPK },
  ];
  const inputs = [
    { txid: Buffer.from(A.committedTxidP).reverse().toString('hex'), vout: 0, value: A.jValueSats, spk: ownSPK, sequence: 0xffffffff },
    { txid: Buffer.from(B_.committedTxidP).reverse().toString('hex'), vout: 0, value: B_.jValueSats, spk: ownSPK, sequence: 0xffffffff },
  ];
  const parts = sighashComponents({ inputs, outputs });
  const inIndex = sighashSide !== undefined ? sighashSide : side;            // RED position: force a wrong inIndex sighash
  const { pre: c1, post: c9, sighash } = reassembleSighash({ inIndex, leafHash, parts });
  const witness = mergeK2V2Witness({
    parentSelf: self.parent, parentOther: other.parent,
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c8: leafHash, c9 },
    ownSPK: wrongOwnSpk || ownSPK, changeValue: CHANGE_VALUE, ownerOut: ownerIn, valueOut: VALUE_OUT,  // wrongOwnSpk: a witness ownSPK ≠ the real input SPK
    amtSelf: self.amount, amtOther: other.amount, outOverride,
  });
  let r, threw = false;
  try { r = runScript(mergeK2V2Ops(side, consts).ops, witness, sighash); } catch { threw = true; }
  return { ok: !threw && r && r.ok === true, peak: threw ? null : r.peakStack };
}

test('merge-leaf GREEN side0: spend the vin0 note of a 14M+7M merge', () => {
  const r = run(0);
  assert.equal(r.ok, true);
  assert.ok(r.peak > 0 && r.peak < 1000, `side0 peak ${r.peak} < 1000`);
});

test('merge-leaf GREEN side1: spend the vin1 note (the other instance of the same merge)', () => {
  assert.equal(run(1).ok, true);
});

test('merge-leaf RED inflation: forged amount_out (999M) with a matching c6 still rejects at conservation', () => {
  // the output stateOut + the witness limbs all say 999M (so c6/CSFS pass), but amt_self+amt_other = 21M ⟹ conservation NUMEQUALVERIFY aborts.
  assert.equal(run(0, { outOverride: 999_000_000n }).ok, false);
  assert.equal(run(1, { outOverride: 999_000_000n }).ok, false);
});

test('merge-leaf RED owner_type: a SCRIPT input rejects (KEY-only op-level gate, both instances)', () => {
  assert.equal(run(0, { bOwnerType: OwnerType.SCRIPT }).ok, false); // vin1 (other for side0) is SCRIPT ⟹ owner_type_in_other==KEY fails
  assert.equal(run(1, { bOwnerType: OwnerType.SCRIPT }).ok, false); // vin1 is self for side1 ⟹ owner_type_in_self==KEY fails
});

test('merge-leaf RED position: the side0 leaf bound to the inIndex-1 sighash rejects (baked c7)', () => {
  assert.equal(run(0, { sighashSide: 1 }).ok, false); // leaf bakes c7=inIndex0; real sighash is inIndex1 ⟹ computed != real ⟹ CSFS fails
});

test('merge-leaf RED wrong ownSPK witness: a witness ownSPK != the real input SPK rejects (GPT §5.1)', () => {
  // ownSPK is read from the witness (it is the circular transferSPK, un-bakeable). A wrong one ⟹ the kernels reconstruct each parent
  // tokenOut with it ⟹ hash256(parent) != committedTxidP ⟹ the kernel EQUALVERIFY aborts (and c4 would also mismatch the real shaScriptPubKeys).
  assert.equal(run(0, { wrongOwnSpk: p2tr(0xee) }).ok, false);
  assert.equal(run(1, { wrongOwnSpk: p2tr(0xee) }).ok, false);
});

// ---- step 2b-2: the FULL leaf with depth-2 LINEAGE (a transfer-grandparent arm per input). ----
// Build a real chain great-grandparent → txGP (1→1) → txP (1→1) → the merge-input note, so txP.vin0 == hash256(txGP)‖0.
function buildChain(amount, owner, seed) {
  const ggpOutpoint = Buffer.concat([S(B(seed)), Buffer.alloc(4)]);                 // dummy great-grandparent outpoint (36B)
  const tailGP = Buffer.concat([u64(8000), B(0x22), changeSPK, Buffer.alloc(4)]);    // changeOut_GP ‖ nLockTime
  const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: ggpOutpoint, valGP: 50000, ownerGP: owner, amtGP: BigInt(amount), ownerTypeGP: OwnerType.KEY, tailGP };
  const committedTxidGP = hash256(transferGrandparentV2(gpArgs).txGP);
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(committedTxidGP, 0, 0xffffffff);                                       // txP consumes txGP @ vout0
  txP.addOutput(ownSPK, 50000); txP.addOutput(stateScript(BigInt(amount), owner, OwnerType.KEY), 0); txP.addOutput(changeSPK, 9000);
  const legacyP = txP.toBuffer();
  return {
    gpArgs, amount: BigInt(amount), jValueSats: 50000, committedTxidP: hash256(legacyP),
    parent: { committedTxidP: hash256(legacyP), vin0Outpoint: legacyP.subarray(5, 41), changeVal: 9000,
      outputs: [{ value: 50000, amountSer: encodeAmount(BigInt(amount)), owner, ownerType: OwnerType.KEY }] },
  };
}

function runLineage(side, { amtA = 14_000_000n, amtB = 7_000_000n, tamperGpSelf = false } = {}) {
  const A = buildChain(amtA, ownerIn, 0x42), B_ = buildChain(amtB, ownerIn, 0x43);
  const self = side === 0 ? A : B_, other = side === 0 ? B_ : A;
  const out = amtA + amtB;
  const outputs = [
    { value: VALUE_OUT, script: ownSPK },
    { value: 0, script: stateScript(out, ownerIn, OwnerType.KEY) },
    { value: CHANGE_VALUE, script: changeSPK },
  ];
  const inputs = [
    { txid: Buffer.from(A.committedTxidP).reverse().toString('hex'), vout: 0, value: A.jValueSats, spk: ownSPK, sequence: 0xffffffff },
    { txid: Buffer.from(B_.committedTxidP).reverse().toString('hex'), vout: 0, value: B_.jValueSats, spk: ownSPK, sequence: 0xffffffff },
  ];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, post: c9, sighash } = reassembleSighash({ inIndex: side, leafHash, parts });
  const gpSelf = tamperGpSelf ? { ...self.gpArgs, amtGP: self.amount + 1n } : self.gpArgs;        // tamper ⟹ txGP txid ≠ txP.vin0
  const witness = mergeK2V2LineageWitness({
    parentSelf: self.parent, parentOther: other.parent,
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c8: leafHash, c9 },
    ownSPK, changeValue: CHANGE_VALUE, ownerOut: ownerIn, valueOut: VALUE_OUT,
    amtSelf: self.amount, amtOther: other.amount, gpSelf, gpOther: other.gpArgs,
  });
  let r, threw = false;
  try { r = runScript(mergeK2V2LineageOps(side, consts).ops, witness, sighash); } catch { threw = true; }
  return { ok: !threw && r && r.ok === true, peak: threw ? null : r.peakStack };
}

test('merge-leaf LINEAGE GREEN side0+side1: both inputs prove a transfer-grandparent lineage', () => {
  const r0 = runLineage(0); assert.equal(r0.ok, true);
  assert.ok(r0.peak > 0 && r0.peak < 1000, `full-lineage leaf peak ${r0.peak} < 1000`);
  assert.equal(runLineage(1).ok, true);
});

test('merge-leaf LINEAGE RED: a fabricated/wrong grandparent for self rejects (closes the C-1 gap)', () => {
  assert.equal(runLineage(0, { tamperGpSelf: true }).ok, false); // reconstructed txGP_self txid ≠ txP_self.vin0 ⟹ arm EQUALVERIFY aborts
});

// ---- changeWitness (BRICK 2): every change SPK spender-chosen, none baked. ----
test('merge-leaf changeWitness GREEN: 5 DISTINCT change addresses (2 gp, 2 parent, 1 current) all bind', () => {
  const cwConsts = { ...consts, changeWitness: true };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner = H160(P);
  const parSelf = p2tr(0x91), parOther = p2tr(0x92), cur = p2tr(0x93), gpSelfCh = p2tr(0x94), gpOtherCh = p2tr(0x95);
  const chain = (amount, seed, parCh, gpCh) => {
    const tailGP = Buffer.concat([u64(8000), B(0x22), gpCh, Buffer.alloc(4)]);
    const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(seed)), Buffer.alloc(4)]), valGP: 50000, ownerGP: owner, amtGP: BigInt(amount), ownerTypeGP: OwnerType.KEY, tailGP };
    const cGP = hash256(transferGrandparentV2(gpArgs).txGP);
    const txP = new bells.Transaction(); txP.version = 2; txP.addInput(cGP, 0, 0xffffffff);
    txP.addOutput(ownSPK, 50000); txP.addOutput(stateScript(BigInt(amount), owner, OwnerType.KEY), 0); txP.addOutput(parCh, 9000);
    const lp = txP.toBuffer();
    return { gpArgs, amount: BigInt(amount), committedTxidP: hash256(lp),
      parent: { committedTxidP: hash256(lp), vin0Outpoint: lp.subarray(5, 41), changeVal: 9000, outputs: [{ value: 50000, amountSer: encodeAmount(BigInt(amount)), owner, ownerType: OwnerType.KEY }] } };
  };
  const A = chain(14_000_000n, 0x42, parSelf, gpSelfCh), B_ = chain(7_000_000n, 0x43, parOther, gpOtherCh);
  const outputs = [{ value: 40000, script: ownSPK }, { value: 0, script: stateScript(21_000_000n, owner, OwnerType.KEY) }, { value: 15000, script: cur }];
  const inputs = [{ txid: Buffer.from(A.committedTxidP).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff },
    { txid: Buffer.from(B_.committedTxidP).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = mergeK2V2LineageWitness({
    parentSelf: A.parent, parentOther: B_.parent,
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c8: leafHash, c9 },
    ownSPK, changeValue: 15000, ownerOut: owner, valueOut: 40000, amtSelf: A.amount, amtOther: B_.amount,
    gpSelf: A.gpArgs, gpOther: B_.gpArgs, cw: { curChangeSpk: cur, parSelfChangeSpk: parSelf, parOtherChangeSpk: parOther },
  });
  const r = runScript(mergeK2V2LineageOps(0, cwConsts).ops, witness, sighash);
  assert.equal(r.ok, true, 'all 5 spender-chosen change addresses bind under changeWitness (BRICK 2 decentralization)');
});

test('merge-leaf changeWitness RED: a forged current change (≠ the c6-bound output) rejects', () => {
  const cwConsts = { ...consts, changeWitness: true };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner = H160(P);
  const parSelf = p2tr(0x91), parOther = p2tr(0x92), cur = p2tr(0x93), gpSelfCh = p2tr(0x94), gpOtherCh = p2tr(0x95);
  const chain = (amount, seed, parCh, gpCh) => {
    const tailGP = Buffer.concat([u64(8000), B(0x22), gpCh, Buffer.alloc(4)]);
    const gpArgs = { tokenId, ownSPK, gpVin0Outpoint: Buffer.concat([S(B(seed)), Buffer.alloc(4)]), valGP: 50000, ownerGP: owner, amtGP: BigInt(amount), ownerTypeGP: OwnerType.KEY, tailGP };
    const cGP = hash256(transferGrandparentV2(gpArgs).txGP);
    const txP = new bells.Transaction(); txP.version = 2; txP.addInput(cGP, 0, 0xffffffff);
    txP.addOutput(ownSPK, 50000); txP.addOutput(stateScript(BigInt(amount), owner, OwnerType.KEY), 0); txP.addOutput(parCh, 9000);
    const lp = txP.toBuffer();
    return { gpArgs, amount: BigInt(amount), committedTxidP: hash256(lp),
      parent: { committedTxidP: hash256(lp), vin0Outpoint: lp.subarray(5, 41), changeVal: 9000, outputs: [{ value: 50000, amountSer: encodeAmount(BigInt(amount)), owner, ownerType: OwnerType.KEY }] } };
  };
  const A = chain(14_000_000n, 0x42, parSelf, gpSelfCh), B_ = chain(7_000_000n, 0x43, parOther, gpOtherCh);
  const outputs = [{ value: 40000, script: ownSPK }, { value: 0, script: stateScript(21_000_000n, owner, OwnerType.KEY) }, { value: 15000, script: cur }];
  const inputs = [{ txid: Buffer.from(A.committedTxidP).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff },
    { txid: Buffer.from(B_.committedTxidP).reverse().toString('hex'), vout: 0, value: 50000, spk: ownSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const witness = mergeK2V2LineageWitness({
    parentSelf: A.parent, parentOther: B_.parent,
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c8: leafHash, c9 },
    ownSPK, changeValue: 15000, ownerOut: owner, valueOut: 40000, amtSelf: A.amount, amtOther: B_.amount,
    gpSelf: A.gpArgs, gpOther: B_.gpArgs, cw: { curChangeSpk: p2tr(0xee), parSelfChangeSpk: parSelf, parOtherChangeSpk: parOther }, // forged current change
  });
  let threw = false, ok = null;
  try { ok = runScript(mergeK2V2LineageOps(0, cwConsts).ops, witness, sighash).ok; } catch { threw = true; }
  assert.ok(threw || ok === false, 'a current change SPK ≠ the real c6-bound output rejects via CSFS');
});
