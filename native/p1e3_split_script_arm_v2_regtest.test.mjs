// P2-0 BRICK 8 — the SCRIPT-owned arm at CONSENSUS (the DeFi enabler) with REAL Schnorr. Proves what scriptsim CANNOT: the byte-exact
// 2-INPUT sighash (c2=SHA256(outpoint0‖outpoint1), c4=SHA256(varslice(ownSPK)‖varslice(controllerSPK))) == bellsd's consensus
// tapscript sighash for [SCRIPT note@vin0, controller@vin1], AND that the controller co-spend authorizes the SCRIPT note with NO
// owner key. The controller is a TOY OP_TRUE (the GREEN proves the mechanism; the no-escape controller is its own covenant, BRICK 8
// STEP 9). Run (regtest up): node --test native/p1e3_split_script_arm_v2_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { encodeStateV2, encodeAmount, tokenId, OwnerType } from './wire.mjs';
import { splitFullLineageV2Ops, buildSplitFullLineageV2Leaf, splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-0 SCRIPT arm regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, O = bells.opcodes, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const changeSPK = p2tr(0x77);

test('P2-0 SCRIPT arm at CONSENSUS: a controller co-spend authorizes a SCRIPT note split, real Schnorr, NO owner key', { skip }, async () => {
  const Mp = 2, j = 1, M = 2;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const cov = makeCovenantRaw(buildSplitFullLineageV2Leaf(Mp, j, M, N, { tokenId: G, changeSPK, arm: 'script' }));
  const ownSPK = cov.output;
  const controllerSPK = opTrue.output;                         // the TOY controller (OP_TRUE) — its address is the committed controllerSPK
  const poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
  const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
  console.log(`\nP2-0 SCRIPT-arm leaf ${cov.address} (${cov.leaf.length}B)`);

  const priv = Buffer.alloc(32, 0x0b);                         // the introspection EPHEMERAL key (NOT the owner — there is no owner key)
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);

  // txP: a split whose child j is the SCRIPT note (owner = the controller descriptor, owner_type=SCRIPT); input = a plain OP_TRUE.
  const txpChildren = [
    { value: 100000, amount: 7_000_000n, owner: Buffer.alloc(20, 0xc0), ownerType: OwnerType.KEY },
    { value: 300000, amount: 14_000_000n, owner: SCRIPT_OWNER, ownerType: OwnerType.SCRIPT },
  ];
  const n0 = await fund(opTrue, 5);
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(n0.fundTxid, 'hex').reverse(), n0.vout, 0xffffffff);
  for (const c of txpChildren) { txP.addOutput(ownSPK, c.value); txP.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
  const txpChangeVal = n0.valueSats - 400000 - 1000000;
  txP.addOutput(changeSPK, txpChangeVal);
  const txPLegacy = txP.toBuffer(); const committedTxidP = hash256(txPLegacy), vin0Outpoint = txPLegacy.subarray(5, 41);
  txP.ins[0].witness = [opTrue.leaf, opTrue.controlBlock];
  await expectAccept(txP.toHex());
  console.log(`  txP (SCRIPT note @ child ${j}) ${Buffer.from(committedTxidP).reverse().toString('hex')}`);

  // the controller UTXO @ controllerSPK (the OP_TRUE address).
  const ctrl = await fund(opTrue, 1);
  const ctrlOutpoint = Buffer.concat([Buffer.from(ctrl.fundTxid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(ctrl.vout); return b; })()]);

  const note = { valueSats: txpChildren[j].value };
  const children = [{ amount: 5_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000, ownerType: OwnerType.KEY }, { amount: 9_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000, ownerType: OwnerType.SCRIPT }];

  const buildSpend = ({ oneInput, wrongCtrlSpk } = {}) => {
    const amountIn = 14_000_000n;
    const leafHash = tapLeafHash(cov.leaf);
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(committedTxidP, 2 * j, 0xffffffff);                            // vin0 = the SCRIPT note
    if (!oneInput) tx.addInput(Buffer.from(ctrl.fundTxid, 'hex').reverse(), ctrl.vout, 0xffffffff); // vin1 = the controller
    const outs = [];
    for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner, c.ownerType) }); }
    // FUND: the 2-input spend brings BOTH the note value AND the controller's input value — the change must absorb both or the
    // controller's ~1 BEL becomes fee (> -maxtxfee). The covenant binds this change value via c6 regardless of its magnitude.
    const inSats = oneInput ? note.valueSats : note.valueSats + ctrl.valueSats;
    const changeValue = inSats - 80000 - 20000; outs.push({ value: changeValue, script: changeSPK });
    for (const o of outs) tx.addOutput(o.script, o.value);
    const prevSpks = oneInput ? [ownSPK] : [ownSPK, controllerSPK];
    const prevVals = oneInput ? [note.valueSats] : [note.valueSats, ctrl.valueSats];
    const real = tx.hashForWitnessV1(0, prevSpks, prevVals, bells.Transaction.SIGHASH_DEFAULT, leafHash);
    const sig = Buffer.from(ecc.signSchnorr(real, priv));
    const inputs = [{ txid: Buffer.from(committedTxidP).reverse().toString('hex'), vout: 2 * j, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }];
    if (!oneInput) inputs.push({ txid: ctrl.fundTxid, vout: ctrl.vout, value: ctrl.valueSats, spk: controllerSPK, sequence: 0xffffffff });
    const parts = sighashComponents({ inputs, outputs: outs });
    const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
    const w = splitFullLineageV2ScriptWitness({ parent: { committedTxidP, vin0Outpoint, changeVal: txpChangeVal, outputs: txpChildren.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
      epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs: children.map((c) => ({ owner: c.owner, value: c.satValue, amount: c.amount, ownerType: c.ownerType })), amountIn, N,
      script: { outpoint1: ctrlOutpoint, controllerSPK: wrongCtrlSpk ?? controllerSPK, poolId, stateId } });
    tx.ins[0].witness = [...w, cov.leaf, cov.controlBlock];
    if (!oneInput) tx.ins[1].witness = [opTrue.leaf, opTrue.controlBlock];
    return { tx, w, real };
  };

  // GREEN — the controller co-spend authorizes the SCRIPT note split.
  const g = buildSpend();
  assert.equal(runScript(splitFullLineageV2Ops(Mp, j, M, N, { tokenId: G, changeSPK, arm: 'script' }).ops, g.w, g.real).ok, true, 'scriptsim GREEN before broadcast');
  const acc = await expectAccept(g.tx.toHex());
  assert.ok(acc.confirmations >= 1, 'SCRIPT-arm spend not confirmed');
  console.log(`  GREEN: controller co-spend authorized the SCRIPT split (no owner key) ${acc.txid} — 2-input c2/c4 byte-exact`);

  // RED — 1-input (no controller co-spend): the 2-input c2/c4 cannot match a 1-input sighash.
  const r1 = buildSpend({ oneInput: true });
  assert.equal((await notMinable(r1.tx.toHex())).mined, false, 'a 1-input spend (no controller) must be rejected');
  console.log('  RED 1-input (no controller): rejected at block-validation');

  console.log('\n✅ P2-0 SCRIPT arm at CONSENSUS: the controller co-spend authorizes a SCRIPT note with NO owner key (the DeFi enabler), real Schnorr.\n');
});
