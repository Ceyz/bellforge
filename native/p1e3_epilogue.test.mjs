// scriptsim test for the N9 EPILOGUE (no regtest node needed): mono-input transfer that computes c2/c4/c6, assembles
// the 211-byte message, binds CSFS+CHECKSIG, and welds owner-auth. Registers (amount_in/owner_in/ownSPK/committedTxidP)
// are passed directly as witness here ("as if proven"); the reconstruction feeds them in the full leaf.
// Run: node --test p1e3_epilogue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, tapLeafHash } from '../canaries/tap.mjs';
import { sighashComponents, reassembleSighash, u64, varslice } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { p1e3EpilogueOps, buildP1e3EpilogueScript } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const G = Buffer.concat([Buffer.alloc(32, 0x6e), B(0, 0, 0, 0)]); // token_id (36B)
const VTI = Buffer.concat([B(0x01), G]);

// Build a real mono-input transfer tx spending the note at (committedTxidP, 0) and return {ops witness, realSighash}.
function build({ amount = 12345n, ownerPriv = Buffer.alloc(32, 0x3e), outOwner = Buffer.alloc(20, 0x77),
                 out0Value = 100000, noteSats = 1_000_000, fee = 10000, badOutAmount = null } = {}) {
  const cov = makeCovenantRaw(buildP1e3EpilogueScript({ tokenId: G }));
  const ownSPK = cov.output;                                          // the covenant's own SPK (replicated)
  const committedTxidP = S(Buffer.from('note-parent-seed'));          // 32B internal parent txid
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const P = Buffer.from(ecc.pointFromScalar(ownerPriv, true)).subarray(1);
  const owner_in = H160(P);                                           // current owner = the spender
  const changeSPK = p2tr(0x33);
  const changeValue = noteSats - out0Value - fee;

  // outputs: [tokenOut(new, =ownSPK), stateOut_new, change]
  const stateScript = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount: badOutAmount ?? amount, owner: outOwner }))]);
  const outs = [
    { value: out0Value, script: ownSPK },
    { value: 0, script: stateScript },
    { value: changeValue, script: changeSPK },
  ];
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) tx.addOutput(o.script, o.value);

  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: txidDisplay, vout: 0, value: noteSats, spk: ownSPK, sequence: 0xffffffff }],
    outputs: outs,
  });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [ownSPK], [noteSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');
  const sig = Buffer.from(ecc.signSchnorr(real, ownerPriv));

  // witness deepest->top: [sig, P, c1, c3, c5, c7, c8, c9, changeSPK, changeValue, out_owner, amount_in, out0Value, ownSPK, committedTxidP, owner_in]
  const witness = [
    sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(amount), u64(out0Value), ownSPK, committedTxidP, owner_in,
  ];
  return { cov, witness, real };
}

test('EPILOGUE GREEN: honest mono-input transfer — c2/c4/c6 + message + binding + owner-auth all pass', () => {
  const { cov, witness, real } = build();
  const r = runScript(p1e3EpilogueOps({ tokenId: G }), witness, real);
  assert.ok(r.ok, `expected GREEN; main=${r.main.map((x) => x.toString('hex'))} trace=${r.trace.slice(-6)}`);
  console.log(`epilogue leaf ${cov.leaf.length}B — scriptsim GREEN`);
});

test('RED over-amount (conservation): the REAL output stateOut commits a DIFFERENT amount than amount_in -> c6 != real -> CSFS mismatch', () => {
  // covenant builds c6 from amount_in=12345; the real tx output commits amount 99999 -> reconstructed c6 != real shaOutputs
  // -> computed_sighash != real -> CSFS asserts msg==real -> throws in scriptsim.
  const { witness, real } = build({ amount: 12345n, badOutAmount: 99999n });
  assert.throws(() => runScript(p1e3EpilogueOps({ tokenId: G }), witness, real), /CSFS message/);
});

test('RED thief wrong-key (owner-auth): spender signs with a key whose hash160 != owner_in', () => {
  // owner_in is committed as hash160(P_owner); the thief presents their own P (and a valid sig over the real sighash for
  // THEIR key), but hash160(thiefP) != owner_in -> EQUALVERIFY fails.
  const { cov, real } = build();
  // rebuild witness with a thief P but keep owner_in = the real owner's hash. Re-sign real with the thief key.
  const thiefPriv = Buffer.alloc(32, 0x99);
  const thiefP = Buffer.from(ecc.pointFromScalar(thiefPriv, true)).subarray(1);
  const ownerP = Buffer.from(ecc.pointFromScalar(Buffer.alloc(32, 0x3e), true)).subarray(1);
  const owner_in = bells.crypto.hash160(ownerP); // committed owner = the real owner
  const sig = Buffer.from(ecc.signSchnorr(real, thiefPriv));
  // recompute the witness with thiefP + thief sig but owner_in = real owner
  const base = build();
  const w = [...base.witness];
  w[0] = sig; w[1] = thiefP; w[w.length - 1] = owner_in;
  assert.throws(() => runScript(p1e3EpilogueOps({ tokenId: G }), w, real), /EQUALVERIFY/);
});

test('RED non-32B P: CSFS_PUBKEY_SIG_PINS rejects a 33-byte pubkey', () => {
  const base = build();
  const w = [...base.witness];
  w[1] = Buffer.concat([w[1], B(0x00)]); // 33-byte P
  assert.throws(() => runScript(p1e3EpilogueOps({ tokenId: G }), w, base.real), /EQUALVERIFY|size/);
});
