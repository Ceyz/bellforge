// P2-0 BRICK 11 brick-3 — the no-escape controller at CONSENSUS (real Schnorr). Proves what scriptsim CANNOT: the toy controller leaf's
// reconstructed 2-input vin1 sighash == bellsd's consensus tapscript sighash, AND that the genesis-lineage proof is enforced at
// block-validation. GREEN: a REAL controller note (minted by its genesis) is spent at vin1 of a 2-input tx (dummy @vin0). RED-1 (the
// keystone B-SCRIPT closure): a DUMMY UTXO funded straight to controllerSPK has NO genesis lineage ⟹ rejected at block-validation ⟹
// cannot authorize a SCRIPT-note theft. Run (regtest up): node --test native/controller_roundtrip_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { u64, sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { runScript } from './scriptsim.mjs';
import { controllerLeafOps, buildControllerLeaf, controllerGenesisTx, controllerStateOut, poolIdFromGenesisOutpoint } from './controllerCovenant.mjs';
import { encodeStateV2, encodeAmount, tokenId, OwnerType } from './wire.mjs';
import { splitFullLineageV2Ops, buildSplitFullLineageV2Leaf, splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 controller round-trip SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, O = bells.opcodes;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const outpointOf = ({ fundTxid, vout }) => Buffer.concat([Buffer.from(fundTxid, 'hex').reverse(), u32le(vout)]);

test('P2-0 controller at CONSENSUS: a REAL controller note (genesis lineage) is spent at vin1, byte-exact 2-input sighash', { skip }, async () => {
  const opTrue = makeCovenant([O.OP_TRUE]);
  const VALUE_0 = 100000n, CG_VAL = 36;                    // VALUE_0 = the controller note's sat value (spendable dust)
  const feeSPK = p2tr(0x99), changeSPK = p2tr(0x55);
  const feeVal = 1000n, feeOut = Buffer.concat([u64(feeVal), Buffer.from([0x22]), feeSPK]);

  // (1) the genesis inputs: M (minter ⟹ pool_id) and CG (the genesis token outpoint, baked in genMid). Both OP_TRUE on regtest.
  const mFund = await fund(opTrue, 1), cgFund = await fund(opTrue, 1);
  const minterOutpoint = outpointOf(mFund), CG = outpointOf(cgFund);
  const consts = { CG, minterOutpoint, VALUE_0, feeOut };
  const cov = makeCovenantRaw(buildControllerLeaf(consts));   // controllerSPK = P2TR(NUMS, controllerLeaf(pool_id baked)) — pool-specific
  const controllerSPK = cov.output;
  const poolId = poolIdFromGenesisOutpoint(minterOutpoint);
  console.log(`\n  controller leaf ${cov.address} (${cov.leaf.length}B), pool_id ${poolId.subarray(0, 6).toString('hex')}…`);

  // (2) build the genesis tx on-node AND via controllerGenesisTx — assert byte-equality so committedTxidP == the real txid.
  const genChangeVal = mFund.valueSats + cgFund.valueSats - Number(VALUE_0) - Number(feeVal) - 100000; // 100k genesis fee
  const g = controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint, changeVal: genChangeVal, changeSPK });
  const stateOut0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), g.stateOut0.subarray(11)]); // OP_RETURN script = 0x6a 0x20 ‖ SHA256(state); stateOut0 = FRAME(11) ‖ SHA256(state)
  const txG = new bells.Transaction(); txG.version = 2;
  txG.addInput(Buffer.from(mFund.fundTxid, 'hex').reverse(), mFund.vout, 0xffffffff);
  txG.addInput(Buffer.from(cgFund.fundTxid, 'hex').reverse(), cgFund.vout, 0xffffffff);
  txG.addOutput(controllerSPK, Number(VALUE_0));
  txG.addOutput(stateOut0Script, 0);
  txG.addOutput(feeSPK, Number(feeVal));
  txG.addOutput(changeSPK, genChangeVal);
  assert.ok(txG.toBuffer().equals(g.tx), 'controllerGenesisTx bytes == the bells.Transaction legacy serialization (committedTxidP authentic)');
  const committedTxidP = hash256(txG.toBuffer());
  assert.ok(committedTxidP.equals(g.genesisTxid), 'genesis txid matches');
  txG.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  txG.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txG.toHex());
  console.log(`  controller genesis mined ${Buffer.from(g.genesisTxid).reverse().toString('hex')} (note @ vout0 = ${VALUE_0} sats)`);

  // (3) the co-spend: vin0 = a dummy OP_TRUE input, vin1 = the controller note (genesis vout0). The controller leaf is BAKED to vin1.
  const dummy = await fund(opTrue, 1);
  const priv = Buffer.alloc(32, 0x0b);                       // the introspection EPHEMERAL key (NOT an owner key — the controller has none)
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const leafHash = tapLeafHash(cov.leaf);

  const buildSpend = ({ committedOverride, vin1Outpoint } = {}) => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(Buffer.from(dummy.fundTxid, 'hex').reverse(), dummy.vout, 0xffffffff);             // vin0 = dummy
    const ctrlOut = vin1Outpoint ?? { txid: Buffer.from(g.genesisTxid).reverse().toString('hex'), vout: 0, val: Number(VALUE_0), spk: controllerSPK };
    tx.addInput(Buffer.from(ctrlOut.txid, 'hex').reverse(), ctrlOut.vout, 0xffffffff);             // vin1 = the controller note
    const spendOut = dummy.valueSats + ctrlOut.val - 80000; tx.addOutput(changeSPK, spendOut);     // c6 is FREE — any output set
    const prevSpks = [opTrue.output, ctrlOut.spk], prevVals = [dummy.valueSats, ctrlOut.val];
    const real = tx.hashForWitnessV1(1, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, leafHash); // inIndex 1 (the controller's vin)
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const inputs = [{ txid: dummy.fundTxid, vout: dummy.vout, value: dummy.valueSats, spk: opTrue.output, sequence: 0xffffffff },
                    { txid: ctrlOut.txid, vout: ctrlOut.vout, value: ctrlOut.val, spk: ctrlOut.spk, sequence: 0xffffffff }];
    const parts = sighashComponents({ inputs, outputs: [{ value: spendOut, script: changeSPK }] });
    const { pre: c1, post: c9 } = reassembleSighash({ inIndex: 1, leafHash, parts });
    const w = [committedOverride ?? committedTxidP, outpointOf(dummy), opTrue.output, controllerSPK, u64(BigInt(genChangeVal)), changeSPK,
      sig, P, c1, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, leafHash, c9];
    tx.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
    tx.ins[1].witness = [...w, cov.leaf, cov.controlBlock];
    return { tx, w, real };
  };

  const gr = buildSpend();
  assert.equal(runScript(controllerLeafOps(consts).ops, gr.w, gr.real).ok, true, 'scriptsim GREEN before broadcast');
  const acc = await expectAccept(gr.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'controller spend not confirmed');
  console.log(`  GREEN: the controller note authorized at vin1 (real lineage, 2-input c2/c4 byte-exact) ${acc.txid}`);

  console.log('\n✅ P2-0 controller at CONSENSUS: a lineage-proven controller note is spendable at vin1, real Schnorr.\n');
});

const stateScript = (G, amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

test('P2-0 FULL DeFi primitive at CONSENSUS: a $BOUND SCRIPT note moves ONLY because THIS no-escape controller co-authorizes (both leaves pass)', { skip }, async () => {
  // ── the controller instance (genesis → a real no-escape controller note) ──────────────────────────────────────────────────────
  const opTrue = makeCovenant([O.OP_TRUE]);
  const VALUE_0 = 100000n, ctrlGenChangeSPK = p2tr(0x55), coChangeSPK = p2tr(0x77);
  const feeSPK = p2tr(0x99), feeVal = 1000n, feeOut = Buffer.concat([u64(feeVal), Buffer.from([0x22]), feeSPK]);
  const mFund = await fund(opTrue, 1), cgFund = await fund(opTrue, 1);
  const minterOutpoint = outpointOf(mFund), CG = outpointOf(cgFund);
  const ctrlConsts = { CG, minterOutpoint, VALUE_0, feeOut };
  const ctrlCov = makeCovenantRaw(buildControllerLeaf(ctrlConsts));
  const controllerSPK = ctrlCov.output;
  const poolId = poolIdFromGenesisOutpoint(minterOutpoint), stateId = poolId;   // the SCRIPT note's descriptor will bind THIS pool_id
  const genChangeVal = mFund.valueSats + cgFund.valueSats - Number(VALUE_0) - Number(feeVal) - 100000;
  const g = controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint, changeVal: genChangeVal, changeSPK: ctrlGenChangeSPK });
  const txG = new bells.Transaction(); txG.version = 2;
  txG.addInput(Buffer.from(mFund.fundTxid, 'hex').reverse(), mFund.vout, 0xffffffff);
  txG.addInput(Buffer.from(cgFund.fundTxid, 'hex').reverse(), cgFund.vout, 0xffffffff);
  txG.addOutput(controllerSPK, Number(VALUE_0));
  txG.addOutput(Buffer.concat([Buffer.from([0x6a, 0x20]), g.stateOut0.subarray(11)]), 0);
  txG.addOutput(feeSPK, Number(feeVal)); txG.addOutput(ctrlGenChangeSPK, genChangeVal);
  assert.ok(txG.toBuffer().equals(g.tx), 'controller genesis bytes match');
  const ctrlCommitted = hash256(txG.toBuffer());
  txG.ins[0].witness = txG.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txG.toHex());

  // ── the $BOUND SCRIPT note: a split child whose owner = scriptOwnerDescriptor(controllerSPK, pool_id, state_id) ─────────────────
  const Mp = 2, j = 1, M = 2, N = 8;
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const scriptCov = makeCovenantRaw(buildSplitFullLineageV2Leaf(Mp, j, M, N, { tokenId: G, changeSPK: coChangeSPK, arm: 'script' }));
  const ownSPK = scriptCov.output;
  const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);    // hash160(controllerSPK ‖ pool_id ‖ state_id) — the no-key owner
  const txpChildren = [
    { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY },
    { value: 300000, amount: 14_000_000n, owner: SCRIPT_OWNER, ownerType: OwnerType.SCRIPT },
  ];
  const n0 = await fund(opTrue, 5);
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(n0.fundTxid, 'hex').reverse(), n0.vout, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txpChangeVal = n0.valueSats - 400000 - 1000000;
  txP.addOutput(coChangeSPK, txpChangeVal);
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txP.toHex());
  console.log(`\n  SCRIPT note (child ${j}, owner=descriptor) + controller note (pool_id ${poolId.subarray(0, 6).toString('hex')}…) both live`);

  // ── the co-spend: vin0 = the SCRIPT note (SCRIPT-arm leaf), vin1 = the controller note (controller leaf). BOTH must pass. ───────
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const ctrlOutpoint = Buffer.concat([Buffer.from(g.genesisTxid), u32le(0)]); // controller note outpoint = genesisTxid(internal)‖0
  const scriptNoteVal = txpChildren[j].value;
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];
  const amountIn = 14_000_000n;
  const scriptLeafHash = tapLeafHash(scriptCov.leaf), ctrlLeafHash = tapLeafHash(ctrlCov.leaf);

  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidP, 2 * j, 0xffffffff);                                  // vin0 = the SCRIPT note (committedTxidP = internal)
  tx.addInput(Buffer.from(g.genesisTxid), 0, 0xffffffff);                          // vin1 = the controller note (genesisTxid = internal)
  const outs = [];
  for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
  const inSats = scriptNoteVal + Number(VALUE_0);
  const changeValue = inSats - 80000 - 20000; outs.push({ value: changeValue, script: coChangeSPK });
  for (const o of outs) tx.addOutput(o.script, o.value);

  const prevSpks = [ownSPK, controllerSPK], prevVals = [scriptNoteVal, Number(VALUE_0)];
  const parts = sighashComponents({ inputs: [
    { txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 2 * j, value: scriptNoteVal, spk: ownSPK, sequence: 0xffffffff },
    { txid: Buffer.from(g.genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: controllerSPK, sequence: 0xffffffff },
  ], outputs: outs });

  // vin0 — the SCRIPT-arm leaf (inIndex 0).
  const real0 = tx.hashForWitnessV1(0, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, scriptLeafHash);
  const sig0 = Buffer.from(ecc.signSchnorr(real0, priv));
  const s0 = reassembleSighash({ inIndex: 0, leafHash: scriptLeafHash, parts });
  const w0 = splitFullLineageV2ScriptWitness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChangeVal, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig: sig0, P, c1: s0.pre, c3: parts.shaAmounts, c5: parts.shaSequences, c7: s0.mid, c8: scriptLeafHash, c9: s0.post }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn, N,
    script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });

  // vin1 — the controller leaf (inIndex 1).
  const real1 = tx.hashForWitnessV1(1, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, ctrlLeafHash);
  const sig1 = Buffer.from(ecc.signSchnorr(real1, priv));
  const s1 = reassembleSighash({ inIndex: 1, leafHash: ctrlLeafHash, parts });
  const scriptNoteOutpoint = Buffer.concat([committedTxidP, u32le(2 * j)]);
  const w1 = [ctrlCommitted, scriptNoteOutpoint, ownSPK, controllerSPK, u64(BigInt(genChangeVal)), ctrlGenChangeSPK,
    sig1, P, s1.pre, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, ctrlLeafHash, s1.post];

  // scriptsim BOTH leaves before broadcast.
  assert.equal(runScript(splitFullLineageV2Ops(Mp, j, M, N, { tokenId: G, changeSPK: coChangeSPK, arm: 'script' }).ops, w0, real0).ok, true, 'SCRIPT-arm leaf scriptsim GREEN');
  assert.equal(runScript(controllerLeafOps(ctrlConsts).ops, w1, real1).ok, true, 'controller leaf scriptsim GREEN');

  tx.ins[0].witness = [...w0, scriptCov.leaf, scriptCov.controlBlock];
  tx.ins[1].witness = [...w1, ctrlCov.leaf, ctrlCov.controlBlock];
  const acc = await expectAccept(tx.toHex());
  assert.ok(acc.confirmations >= 1, 'the co-spend was not confirmed');
  console.log(`  ✅ GREEN: the SCRIPT note moved + the controller co-authorized in ONE tx — BOTH covenant leaves passed ${acc.txid}`);
  console.log('\n✅ P2-0 FULL DeFi primitive: SCRIPT-owned $BOUND + a no-escape controller, end-to-end at CONSENSUS, real Schnorr.\n');
});

test('RED-1 dummy-UTXO at CONSENSUS (the keystone B-SCRIPT closure): a UTXO funded straight to controllerSPK is UNSPENDABLE', { skip }, async () => {
  const opTrue = makeCovenant([O.OP_TRUE]);
  const VALUE_0 = 100000n, feeSPK = p2tr(0x99), changeSPK = p2tr(0x55), feeVal = 1000n;
  const feeOut = Buffer.concat([u64(feeVal), Buffer.from([0x22]), feeSPK]);
  const mFund = await fund(opTrue, 1), cgFund = await fund(opTrue, 1);
  const minterOutpoint = outpointOf(mFund), CG = outpointOf(cgFund);
  const consts = { CG, minterOutpoint, VALUE_0, feeOut };
  const cov = makeCovenantRaw(buildControllerLeaf(consts));
  const controllerSPK = cov.output;

  // fund controllerSPK DIRECTLY — a UTXO with NO genesis lineage (its parent is a wallet tx, not the controller genesis).
  const dummyNote = await fund(cov, 1);
  const realDummyParent = Buffer.from(dummyNote.fundTxid, 'hex').reverse(); // the dummy's REAL prev-txid (a wallet funding tx)
  const dummy = await fund(opTrue, 1);                                       // vin0 of the theft attempt
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const leafHash = tapLeafHash(cov.leaf);

  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(dummy.fundTxid, 'hex').reverse(), dummy.vout, 0xffffffff);
  tx.addInput(Buffer.from(dummyNote.fundTxid, 'hex').reverse(), dummyNote.vout, 0xffffffff);       // vin1 = the un-lineaged dummy note
  const spendOut = dummy.valueSats + dummyNote.valueSats - 80000; tx.addOutput(changeSPK, spendOut);
  const prevSpks = [opTrue.output, controllerSPK], prevVals = [dummy.valueSats, dummyNote.valueSats];
  const real = tx.hashForWitnessV1(1, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const inputs = [{ txid: dummy.fundTxid, vout: dummy.vout, value: dummy.valueSats, spk: opTrue.output, sequence: 0xffffffff },
                  { txid: dummyNote.fundTxid, vout: dummyNote.vout, value: dummyNote.valueSats, spk: controllerSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs: [{ value: spendOut, script: changeSPK }] });
  const { pre: c1, post: c9 } = reassembleSighash({ inIndex: 1, leafHash, parts });
  // BEST-EFFORT forge: set committedTxidP = the dummy's REAL parent so c2 matches the real shaPrevouts — the genesis reconstruction
  // (HDR_G ‖ M ‖ genMid(CG) ‖ …) then CANNOT hash to a wallet funding txid ⟹ the EQUALVERIFY fails.
  const w = [realDummyParent, outpointOf(dummy), opTrue.output, controllerSPK, u64(0n), changeSPK,
    sig, P, c1, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, leafHash, c9];
  tx.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  tx.ins[1].witness = [...w, cov.leaf, cov.controlBlock];

  const r = await notMinable(tx.toHex());
  assert.equal(r.mined, false, 'a dummy UTXO at controllerSPK (no genesis lineage) MUST be rejected at block-validation');
  console.log('  RED-1 dummy-UTXO: rejected at block-validation (no genesis lineage ⟹ no controllerSPK is freely spendable)');
});

test('RED-7 position at CONSENSUS: the controller is BAKED to vin1 (c7=0x02‖u32le(1)) — spending the note at vin0 is rejected', { skip }, async () => {
  // build a REAL controller note (as in GREEN), then attempt to spend it at vin0 instead of vin1. The baked inIndex==1 (c7) AND the
  // note-SECOND c2 (SHA256(vin0_outpoint ‖ controller_outpoint)) both fail when the controller sits at vin0 ⟹ block-validation reject.
  const opTrue = makeCovenant([O.OP_TRUE]);
  const VALUE_0 = 100000n, feeSPK = p2tr(0x99), changeSPK = p2tr(0x55), feeVal = 1000n;
  const feeOut = Buffer.concat([u64(feeVal), Buffer.from([0x22]), feeSPK]);
  const mFund = await fund(opTrue, 1), cgFund = await fund(opTrue, 1);
  const minterOutpoint = outpointOf(mFund), CG = outpointOf(cgFund);
  const consts = { CG, minterOutpoint, VALUE_0, feeOut };
  const cov = makeCovenantRaw(buildControllerLeaf(consts));
  const controllerSPK = cov.output;
  const genChangeVal = mFund.valueSats + cgFund.valueSats - Number(VALUE_0) - Number(feeVal) - 100000;
  const g = controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint, changeVal: genChangeVal, changeSPK });
  const txG = new bells.Transaction(); txG.version = 2;
  txG.addInput(Buffer.from(mFund.fundTxid, 'hex').reverse(), mFund.vout, 0xffffffff);
  txG.addInput(Buffer.from(cgFund.fundTxid, 'hex').reverse(), cgFund.vout, 0xffffffff);
  txG.addOutput(controllerSPK, Number(VALUE_0));
  txG.addOutput(Buffer.concat([Buffer.from([0x6a, 0x20]), g.stateOut0.subarray(11)]), 0);
  txG.addOutput(feeSPK, Number(feeVal)); txG.addOutput(changeSPK, genChangeVal);
  const ctrlCommitted = hash256(txG.toBuffer());
  txG.ins[0].witness = txG.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txG.toHex());

  const other = await fund(opTrue, 1);                                            // the OTHER input (will sit at vin1)
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const leafHash = tapLeafHash(cov.leaf);
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(g.genesisTxid), 0, 0xffffffff);                          // vin0 = the controller note (WRONG position)
  tx.addInput(Buffer.from(other.fundTxid, 'hex').reverse(), other.vout, 0xffffffff); // vin1 = the other input
  const spendOut = Number(VALUE_0) + other.valueSats - 80000; tx.addOutput(changeSPK, spendOut);
  const prevSpks = [controllerSPK, opTrue.output], prevVals = [Number(VALUE_0), other.valueSats];
  const real = tx.hashForWitnessV1(0, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, leafHash); // signs inIndex 0 (the controller's actual position)
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const inputs = [{ txid: Buffer.from(g.genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: controllerSPK, sequence: 0xffffffff },
                  { txid: other.fundTxid, vout: other.vout, value: other.valueSats, spk: opTrue.output, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs: [{ value: spendOut, script: changeSPK }] });
  const { pre: c1, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = [ctrlCommitted, outpointOf(other), opTrue.output, controllerSPK, u64(BigInt(genChangeVal)), changeSPK,
    sig, P, c1, parts.shaAmounts, parts.shaSequences, parts.shaOutputs, leafHash, c9];
  tx.ins[0].witness = [...w, cov.leaf, cov.controlBlock];
  tx.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];

  const r = await notMinable(tx.toHex());
  assert.equal(r.mined, false, 'a controller spend at vin0 (baked inIndex==1) MUST be rejected at block-validation');
  console.log('  RED-7 position: a vin0 controller spend rejected at block-validation (inIndex==1 baked ⟹ no position-shift/ACP-detach)');
});
