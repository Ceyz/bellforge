// FULL CONTINUATION ARM (Layer 1 + Layer 2) scriptsim test (no node): a fund-safe transfer of a NON-genesis note —
// proves the grandparent txGP (continuation lineage) + the parent txP (amount/owner) + conserves/replicates/owner-auths.
// Run: node --test p1e3_continuation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, tapLeafHash } from '../canaries/tap.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { PRELEN_CONT, VOUT0_LE } from './p1e3Const.mjs';
import { p1e3ContinuationOps, buildP1e3ContinuationScript } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const G = Buffer.concat([Buffer.alloc(32, 0x6e), B(0, 0, 0, 0)]);
const stateScript = (G_, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G_, amount, owner }))]);
const out = (value, script) => ({ value, script });
// genesis consts (baked into the SPK; only the mint-gp branch uses them at runtime — this test exercises transfer-gp)
const feeOut = Buffer.concat([u64(50000n), B(0x16, 0x00, 0x14), Buffer.alloc(20, 0xe1)]);
const CONSTS = { tokenId: G, AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0xd0), VALUE_0: 100000n, feeOut, changeSpkLen: 34 };

// 3-level chain txGP -> txP -> current, all notes locked by the full continuation covenant.
function build({ amount = 12345n, ownerPriv = Buffer.alloc(32, 0x3e), gpOut0Spk = null, curOutAmount = null } = {}) {
  const cov = makeCovenantRaw(buildP1e3ContinuationScript(CONSTS));
  const ownSPK = cov.output;
  const leafHash = tapLeafHash(cov.leaf);
  const P = Buffer.from(ecc.pointFromScalar(ownerPriv, true)).subarray(1);
  const owner_in = H160(P);
  const ownerGP = Buffer.alloc(20, 0x88);

  // --- grandparent txGP ---
  const ggTxid = S(B(0x67, 0x67, 0x67));
  const txGP = new bells.Transaction(); txGP.version = 2;
  txGP.addInput(ggTxid, 0, 0xffffffff);
  txGP.addOutput(gpOut0Spk ?? ownSPK, 1500);                          // out0 (the grandparent note)
  txGP.addOutput(stateScript(G, amount, ownerGP), 0);
  txGP.addOutput(p2tr(0x55), 4321);
  const txGPbuf = txGP.toBuffer();
  const txGPid = hash256(txGPbuf);
  const tailGP = txGPbuf.subarray(PRELEN_CONT + 43);
  const vinGP_outpoint = Buffer.concat([ggTxid, VOUT0_LE]);

  // --- parent txP (spends txGP.out0) ---
  const val0P = 1_000_000;
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(Buffer.from(txGPid), 0, 0xffffffff);                   // vin0 = (txGP, 0) — txGPid is already internal order
  txP.addOutput(ownSPK, val0P);
  txP.addOutput(stateScript(G, amount, owner_in), 0);
  txP.addOutput(p2tr(0x44), 7777);
  const txPbuf = txP.toBuffer();
  const committedTxidP = hash256(txPbuf);
  const tailP = txPbuf.subarray(PRELEN_CONT + 43);
  const vin0_outpoint = Buffer.concat([txGPid, VOUT0_LE]);

  // --- current tx (spends txP.out0) ---
  const out0Value = 100000, fee = 10000, changeValue = val0P - out0Value - fee;
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const outOwner = Buffer.alloc(20, 0x77), changeSPK = p2tr(0x33);
  const outs = [out(out0Value, ownSPK), out(0, stateScript(G, curOutAmount ?? amount, outOwner)), out(changeValue, changeSPK)];
  const cur = new bells.Transaction(); cur.version = 2;
  cur.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) cur.addOutput(o.script, o.value);
  const parts = sighashComponents({ inputs: [{ txid: txidDisplay, vout: 0, value: val0P, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = cur.hashForWitnessV1(0, [ownSPK], [val0P], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, ownerPriv));

  // witness deepest->top: [idx 0..18] + [tailGP, vinGP_outpoint, valGP, ownerGP, amtGP] + gpSelector(empty=transfer-gp)
  const witness = [
    sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(amount), u64(out0Value), ownSPK, committedTxidP, owner_in,
    tailP, vin0_outpoint, u64(val0P),
    tailGP, vinGP_outpoint, u64(1500), ownerGP, u64(amount),
    Buffer.alloc(0),  // gpSelector = empty = transfer-grandparent
  ];
  return { cov, witness, real };
}

test('CONTINUATION GREEN: full Layer-1+2 transfer of a non-genesis note (lineage + amount + conserve + owner-auth)', () => {
  const { cov, witness, real } = build();
  const r = runScript(p1e3ContinuationOps(CONSTS), witness, real);
  assert.ok(r.ok, `expected GREEN; main=${r.main.map((x) => x.toString('hex')).slice(0, 4)} trace=${r.trace.slice(-8)}`);
  console.log(`FULL continuation leaf ${cov.leaf.length}B — scriptsim GREEN (txGP lineage ⊕ txP ⊕ epilogue)`);
});

test('CONTINUATION RED forged-grandparent (mint-from-nothing class): txP.vin[0] spent a NON-covenant output -> reject', () => {
  // The attacker authored a parent whose vin[0] points at their own tx (out0 = an attacker P2TR, not the covenant).
  // The Layer-2 reconstruction forces txGP.out0 == ownSPK -> hash256(txGP) != vin0_outpoint -> EQUALVERIFY reject.
  const { witness, real } = build({ gpOut0Spk: p2tr(0xaa) });
  assert.throws(() => runScript(p1e3ContinuationOps(CONSTS), witness, real), /EQUALVERIFY/);
});

test('CONTINUATION RED over-amount: current stateOut commits a different amount -> c6 mismatch -> CSFS reject', () => {
  const { witness, real } = build({ curOutAmount: 99999n });
  assert.throws(() => runScript(p1e3ContinuationOps(CONSTS), witness, real), /CSFS message/);
});
