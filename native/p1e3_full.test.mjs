// FULL LAYER 1 scriptsim test (no node) — reconstruction ⊕ epilogue: a mono-input token-note transfer that PROVES the
// spent note's amount/owner by rebuilding the parent txP (vout-boundary) and then conserves+replicates+owner-auths the
// new note. No lineage yet (LAYER 2/3). Run: node --test p1e3_full.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, tapLeafHash } from '../canaries/tap.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { PRELEN_CONT, VOUT0_LE } from './p1e3Const.mjs';
import { p1e3Ops, buildP1e3Script } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const G = Buffer.concat([Buffer.alloc(32, 0x6e), B(0, 0, 0, 0)]);   // token_id (36B)

// Build a consistent (parent txP, current transfer tx) pair locked by the FULL p1e3 leaf, return {witness, real}.
function build({ amount = 12345n, ownerPriv = Buffer.alloc(32, 0x3e), outOwner = Buffer.alloc(20, 0x77),
                 val0P = 1_000_000, out0Value = 100000, fee = 10000, claimAmount = null, curOutAmount = null } = {}) {
  const cov = makeCovenantRaw(buildP1e3Script({ tokenId: G }));
  const ownSPK = cov.output;                                        // note SPK = the full covenant
  const leafHash = tapLeafHash(cov.leaf);
  const P = Buffer.from(ecc.pointFromScalar(ownerPriv, true)).subarray(1);
  const owner_in = H160(P);                                         // current owner (signs the current tx)

  // --- parent txP: out0 tokenOut(val0P, ownSPK) | out1 stateOut(amount, owner_in) | out2 change ---
  const gpTxid = S(B(0x67, 0x70));                                  // grandparent txid (internal, non-palindrome)
  const txP = new bells.Transaction(); txP.version = 2;
  txP.addInput(gpTxid, 0, 0xffffffff);
  txP.addOutput(ownSPK, val0P);
  const stateP = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner: owner_in }))]);
  txP.addOutput(stateP, 0);
  txP.addOutput(p2tr(0x44), 7777);
  const txPbuf = txP.toBuffer();
  const committedTxidP = hash256(txPbuf);
  const tailP = txPbuf.subarray(PRELEN_CONT + 43);
  const vin0_outpoint = Buffer.concat([gpTxid, VOUT0_LE]);

  // --- current tx: spends the note (committedTxidP,0); out0 tokenOut(out0Value,ownSPK) | out1 stateOut(amount,outOwner) | out2 change ---
  const txidDisplay = Buffer.from(committedTxidP).reverse().toString('hex');
  const changeValue = val0P - out0Value - fee;
  const changeSPK = p2tr(0x33);
  const stateNew = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount: curOutAmount ?? amount, owner: outOwner }))]);
  const outs = [{ value: out0Value, script: ownSPK }, { value: 0, script: stateNew }, { value: changeValue, script: changeSPK }];
  const cur = new bells.Transaction(); cur.version = 2;
  cur.addInput(Buffer.from(txidDisplay, 'hex').reverse(), 0, 0xffffffff);
  for (const o of outs) cur.addOutput(o.script, o.value);

  const parts = sighashComponents({ inputs: [{ txid: txidDisplay, vout: 0, value: val0P, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = cur.hashForWitnessV1(0, [ownSPK], [val0P], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs');
  const sig = Buffer.from(ecc.signSchnorr(real, ownerPriv));

  // witness deepest->top: [sig,P,c1,c3,c5,c7,c8,c9, changeSPK,changeValue,out_owner,amount_in,out0Value,ownSPK,committedTxidP,owner_in, tailP,vin0_outpoint,tokenOut0val_P]
  const witness = [
    sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9,
    changeSPK, u64(changeValue), outOwner, u64(claimAmount ?? amount), u64(out0Value), ownSPK, committedTxidP, owner_in,
    tailP, vin0_outpoint, u64(val0P),
  ];
  return { cov, witness, real };
}

test('FULL Layer-1 GREEN: prove parent -> conserve+replicate+owner-auth the new note', () => {
  const { cov, witness, real } = build();
  const r = runScript(p1e3Ops({ tokenId: G }), witness, real);
  assert.ok(r.ok, `expected GREEN; main=${r.main.map((x) => x.toString('hex')).slice(0, 4)} trace=${r.trace.slice(-8)}`);
  console.log(`FULL p1e3 leaf ${cov.leaf.length}B — scriptsim GREEN (reconstruction ⊕ epilogue)`);
});

test('FULL RED over-amount: current-tx stateOut commits amount != the proven input amount -> c6 mismatch -> CSFS reject', () => {
  const { witness, real } = build({ amount: 12345n, curOutAmount: 99999n });
  assert.throws(() => runScript(p1e3Ops({ tokenId: G }), witness, real), /CSFS message/);
});

test('FULL RED forged amount_in: claim an input amount that the parent txP does NOT carry -> reconstruction != committedTxidP', () => {
  // claimAmount != the amount actually in txP's stateOut -> rebuilt txP differs -> hash256 != committedTxidP -> EQUALVERIFY.
  const { witness, real } = build({ amount: 12345n, claimAmount: 88888n });
  assert.throws(() => runScript(p1e3Ops({ tokenId: G }), witness, real), /EQUALVERIFY/);
});

test('FULL RED thief wrong-key: owner_in (in the parent) != hash160(spender P) -> owner-auth EQUALVERIFY', () => {
  const base = build();
  // re-sign with a thief key but keep the parent-committed owner_in (so the reconstruction still matches)
  const thiefPriv = Buffer.alloc(32, 0x99);
  const thiefP = Buffer.from(ecc.pointFromScalar(thiefPriv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(base.real, thiefPriv));
  const w = [...base.witness];
  w[0] = sig; w[1] = thiefP; // owner_in (w[15]) stays = hash160(realOwner)
  assert.throws(() => runScript(p1e3Ops({ tokenId: G }), w, base.real), /EQUALVERIFY/);
});
