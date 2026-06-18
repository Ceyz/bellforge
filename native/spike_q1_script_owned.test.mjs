// ⚙️ Q1 FEASIBILITY SPIKE at CONSENSUS — the SCRIPT-OWNED auth hook (docs/PHASE2_BOUND_PLAN.md "Q1 RESOLVED"). Proves on a
// real bellsd regtest node that a token note can DELEGATE its spend authorization to a controller covenant (no token-owner
// sig), that the hook is EXACTLY enforced (2-input + input[1].spk == controllerSPK), and that the dummy-UTXO attack (both GPT
// passes' #1 finding) is defeated by a NON-PERMISSIVE controller — while a permissive one is stealable.
// Run (regtest up): node --test native/spike_q1_script_owned.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectAccept, notMinable, tapLeafHash, destSpk } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { scriptOwnedOps, buildScriptOwnedLeaf } from './spikeQ1ScriptOwned.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nQ1 spike SKIPPED — ${skip}\n`);

const O = bells.opcodes;
const keyOf = (fill) => { const pr = Buffer.alloc(32, fill); return { pr, P: Buffer.from(ecc.pointFromScalar(pr, true)).subarray(1) }; };

// --- the two controllers ---
const ctrl = keyOf(0x55);
const soundController = makeCovenant([ctrl.P, O.OP_CHECKSIG]);   // NON-permissive: needs ctrl's Schnorr sig (key-owned stand-in
//   for the production controller, whose spend condition is N9-style STATE LINEAGE — the token hook is agnostic).
const permissiveController = makeCovenant([O.OP_1]);             // PERMISSIVE: anyone can spend an UTXO at this address.

// Build a 2-input co-spend [tokenNote@0, controller@1] -> 1 wallet output. `signController` returns input[1]'s witness items.
// `sim` runs the scriptsim dry-run of the token leaf first. `commitCtrlSPK` is what the token leaf was built to require.
async function coSpend({ tokenNote, tokenLeaf, tokenCov, controllerCov, ctrlInput, signController, commitCtrlSPK, sim }) {
  const tokenLeafHash = tapLeafHash(tokenLeaf);
  const out = await destSpk();
  const inputs = [
    { txid: tokenNote.fundTxid, vout: tokenNote.vout, value: tokenNote.valueSats, spk: tokenCov.output, sequence: 0xffffffff },
    { txid: ctrlInput.fundTxid, vout: ctrlInput.vout, value: ctrlInput.valueSats, spk: controllerCov.output, sequence: 0xffffffff },
  ];
  const fee = 20000, outVal = tokenNote.valueSats + ctrlInput.valueSats - fee;
  const outputs = [{ value: outVal, script: out }];
  const tx = new bells.Transaction(); tx.version = 2;
  for (const i of inputs) tx.addInput(Buffer.from(i.txid, 'hex').reverse(), i.vout, i.sequence);
  for (const o of outputs) tx.addOutput(o.script, o.value);

  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: tokenLeafHash, parts });
  const spks = inputs.map((i) => i.spk), vals = inputs.map((i) => i.value);
  const real0 = tx.hashForWitnessV1(0, spks, vals, bells.Transaction.SIGHASH_DEFAULT, tokenLeafHash);
  const eph = keyOf(0x77);
  const sig = Buffer.from(ecc.signSchnorr(real0, eph.pr));
  const witnessData = [c1, parts.shaPrevouts, parts.shaAmounts, tokenCov.output, parts.shaSequences, parts.shaOutputs, c7, tokenLeafHash, c9, eph.P, sig];

  if (sim) {
    const r = runScript(scriptOwnedOps(commitCtrlSPK), witnessData, real0);
    assert.ok(r.ok, `scriptsim rejected before broadcast: ${JSON.stringify(r.trace?.slice(-6))}`);
  }
  tx.ins[0].witness = [...witnessData, tokenLeaf, tokenCov.controlBlock];
  tx.ins[1].witness = signController(tx, { spks, vals });
  return tx.toHex();
}

test('Q1 GREEN — the script-owned hook authorizes a spend delegated to the (sound) controller, NO token-owner sig', { skip }, async () => {
  const tokenLeaf = buildScriptOwnedLeaf(soundController.output);
  const tokenCov = makeCovenantRaw(tokenLeaf);
  const tokenNote = await fund(tokenCov, 1);
  const ctrlInput = await fund(soundController, 1);
  const hex = await coSpend({
    tokenNote, tokenLeaf, tokenCov, controllerCov: soundController, ctrlInput, commitCtrlSPK: soundController.output, sim: true,
    signController: (tx, { spks, vals }) => {
      const real1 = tx.hashForWitnessV1(1, spks, vals, bells.Transaction.SIGHASH_DEFAULT, tapLeafHash(soundController.leaf));
      return [Buffer.from(ecc.signSchnorr(real1, ctrl.pr)), soundController.leaf, soundController.controlBlock];
    },
  });
  const acc = await expectAccept(hex);
  assert.ok(acc.confirmations >= 1, 'green co-spend not confirmed');
  console.log(`Q1 GREEN: token note spent by co-spending the controller, no owner sig — confirmed ${acc.txid}`);
});

test('Q1 RED — the note cannot be spent ALONE (the 2-input controller co-spend is mandatory)', { skip }, async () => {
  const tokenLeaf = buildScriptOwnedLeaf(soundController.output);
  const tokenCov = makeCovenantRaw(tokenLeaf);
  const tokenNote = await fund(tokenCov, 1);
  // 1-input spend: real shaScriptPubKeys (1 input) != the covenant's reconstructed 2-input c4 -> binding fails.
  const out = await destSpk();
  const inputs = [{ txid: tokenNote.fundTxid, vout: tokenNote.vout, value: tokenNote.valueSats, spk: tokenCov.output, sequence: 0xffffffff }];
  const outputs = [{ value: tokenNote.valueSats - 20000, script: out }];
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(tokenNote.fundTxid, 'hex').reverse(), tokenNote.vout, 0xffffffff);
  tx.addOutput(out, outputs[0].value);
  const lh = tapLeafHash(tokenLeaf);
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: lh, parts });
  const real0 = tx.hashForWitnessV1(0, [tokenCov.output], [tokenNote.valueSats], bells.Transaction.SIGHASH_DEFAULT, lh);
  const eph = keyOf(0x77), sig = Buffer.from(ecc.signSchnorr(real0, eph.pr));
  tx.ins[0].witness = [c1, parts.shaPrevouts, parts.shaAmounts, tokenCov.output, parts.shaSequences, parts.shaOutputs, c7, lh, c9, eph.P, sig, tokenLeaf, tokenCov.controlBlock];
  const r = await notMinable(tx.toHex());
  assert.equal(r.mined, false, 'a 1-input spend must be rejected at CONSENSUS');
  console.log(`Q1 RED (spent alone): rejected at block-validation — ${r.error}`);
});

test('Q1 RED — co-spending the WRONG controller SPK is rejected (the exact controllerSPK is pinned)', { skip }, async () => {
  const tokenLeaf = buildScriptOwnedLeaf(soundController.output);     // note requires the SOUND controller
  const tokenCov = makeCovenantRaw(tokenLeaf);
  const tokenNote = await fund(tokenCov, 1);
  const wrongInput = await fund(permissiveController, 1);             // but we co-spend the PERMISSIVE one (different spk)
  const hex = await coSpend({
    tokenNote, tokenLeaf, tokenCov, controllerCov: permissiveController, ctrlInput: wrongInput, commitCtrlSPK: soundController.output,
    signController: () => [permissiveController.leaf, permissiveController.controlBlock],
  });
  const r = await notMinable(hex);
  assert.equal(r.mined, false, 'a co-spend whose input[1].spk != the committed controllerSPK must be rejected');
  console.log(`Q1 RED (wrong controller): rejected at block-validation — ${r.error}`);
});

test('Q1 RED — DUMMY-UTXO at a NON-PERMISSIVE controller cannot authorize (attacker lacks the controller spend condition)', { skip }, async () => {
  const tokenLeaf = buildScriptOwnedLeaf(soundController.output);
  const tokenCov = makeCovenantRaw(tokenLeaf);
  const tokenNote = await fund(tokenCov, 1);
  const dummy = await fund(soundController, 1);    // ANYONE can fund a UTXO at the controller address...
  const attacker = keyOf(0xee);                    // ...but the attacker does NOT hold ctrl's key.
  const hex = await coSpend({
    tokenNote, tokenLeaf, tokenCov, controllerCov: soundController, ctrlInput: dummy, commitCtrlSPK: soundController.output,
    signController: (tx, { spks, vals }) => {       // a BAD sig (attacker's key) — the controller's CHECKSIG will fail
      const real1 = tx.hashForWitnessV1(1, spks, vals, bells.Transaction.SIGHASH_DEFAULT, tapLeafHash(soundController.leaf));
      return [Buffer.from(ecc.signSchnorr(real1, attacker.pr)), soundController.leaf, soundController.controlBlock];
    },
  });
  const r = await notMinable(hex);
  assert.equal(r.mined, false, 'a dummy UTXO at a non-permissive controller must NOT authorize the token spend');
  console.log(`Q1 RED (dummy-UTXO defense): rejected at block-validation — ${r.error} — the auth delegates to the controller's own spend condition`);
});

test('Q1 THREAT — a PERMISSIVE controller IS stealable (proves WHY controllerSPK must be non-permissive + state-lineage)', { skip }, async () => {
  const tokenLeaf = buildScriptOwnedLeaf(permissiveController.output); // note (mistakenly) committed to a PERMISSIVE controller
  const tokenCov = makeCovenantRaw(tokenLeaf);
  const tokenNote = await fund(tokenCov, 1);
  const dummy = await fund(permissiveController, 1);                   // anyone funds + spends this trivially
  const hex = await coSpend({
    tokenNote, tokenLeaf, tokenCov, controllerCov: permissiveController, ctrlInput: dummy, commitCtrlSPK: permissiveController.output, sim: true,
    signController: () => [permissiveController.leaf, permissiveController.controlBlock],
  });
  const acc = await expectAccept(hex);
  assert.ok(acc.confirmations >= 1, 'the permissive-controller steal should confirm (demonstrating the threat)');
  console.log(`Q1 THREAT: a note committed to a PERMISSIVE controller was stolen via a dummy UTXO — confirmed ${acc.txid}. Lesson: controllerSPK MUST be a no-escape, state-lineage covenant.`);
});
