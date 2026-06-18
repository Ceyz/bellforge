// MEASUREMENT test for the N9 transfer-leaf byte-layout constants (no regtest node needed — pure serialization).
// Proves p1e3Const.mjs reconstructs the EXACT legacy serialization of a real belcoinjs transfer tx (mono-input,
// 3 outputs) and a real genesis mint tx (2-input [M,G], 4 outputs). If these pass, hash256(reconstruction)==txid
// for the real parent/grandparent, so the on-stack reconstruction in p1e3Covenant.mjs is byte-exact.
// Run: node --test p1e3_const.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64, u32, varslice } from './sighashParts.mjs';
import {
  HDR_T, HDR_G, CONT_MID, VINTAIL, genMid, LOCKTIME0, VOUT0_LE,
  PRELEN_CONT, prelenGen, FRAME,
} from './p1e3Const.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const p2tr = (fill) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, fill)]);
const stateScript = (fill) => Buffer.concat([Buffer.from([0x6a, 0x20]), Buffer.alloc(32, fill)]); // OP_RETURN PUSH32
const out = (value, script) => Buffer.concat([u64(value), varslice(script)]);
const legacyBuf = (tx) => tx.toBuffer(); // no witness set on any input -> legacy (no marker/flag/witness)

test('CONT_MID reconstructs a real mono-input / 3-output transfer (continuation parent), byte-exact', () => {
  const tx = new bells.Transaction();
  tx.version = 2;
  const gpTxidInternal = Buffer.alloc(32, 0xab); // grandparent txid (internal order)
  tx.addInput(gpTxidInternal, 0, 0xffffffff);
  const tokenSpk = p2tr(0x11), changeSpk = p2tr(0x33), st = stateScript(0x22);
  tx.addOutput(tokenSpk, 1000);  // out[0] tokenOut
  tx.addOutput(st, 0);           // out[1] stateOut (OP_RETURN, value 0)
  tx.addOutput(changeSpk, 5000); // out[2] change
  const real = legacyBuf(tx);

  const outpoint = Buffer.concat([gpTxidInternal, VOUT0_LE]);              // 36B, vout=0 (R1)
  const tokenOut0 = out(1000, tokenSpk);                                  // 43B
  const stateOut = out(0, st);                                           // 43B
  const changeOut = out(5000, changeSpk);
  const recon = Buffer.concat([HDR_T, outpoint, CONT_MID, tokenOut0, stateOut, changeOut, LOCKTIME0]);

  assert.equal(tokenOut0.length, 43, 'tokenOut0 must be 43B');
  assert.equal(stateOut.length, 43, 'stateOut must be 43B');
  assert.ok(stateOut.subarray(0, 11).equals(FRAME), 'stateOut prefix must equal FRAME');
  assert.ok(recon.equals(real), `continuation reconstruction mismatch:\n recon=${recon.toString('hex')}\n real =${real.toString('hex')}`);
  // the note's stateOut starts at PRELEN_CONT
  assert.ok(real.subarray(PRELEN_CONT, PRELEN_CONT + 43).equals(stateOut), `stateOut not at derived offset ${PRELEN_CONT}`);
  assert.ok(hash256(recon).equals(hash256(real)), 'hash256 mismatch');
});

test('genMid(G) reconstructs a real 2-input [M,G] / 4-output genesis mint (genesis parent), byte-exact', () => {
  const tx = new bells.Transaction();
  tx.version = 2;
  const mTxidInternal = Buffer.alloc(32, 0xcc); // minter UTXO txid
  const gTxidInternal = Buffer.alloc(32, 0xdd); const gVout = 1; // G outpoint
  tx.addInput(mTxidInternal, 0, 0xffffffff); // vin0 = M
  tx.addInput(gTxidInternal, gVout, 0xffffffff); // vin1 = G
  const tokenSpk = p2tr(0x11), feeSpk = p2wpkh(0xe1), changeSpk = p2tr(0x33), st = stateScript(0x22);
  tx.addOutput(tokenSpk, 1000);  // out[0] tokenNote
  tx.addOutput(st, 0);           // out[1] stateOut
  tx.addOutput(feeSpk, 50000);   // out[2] fee
  tx.addOutput(changeSpk, 5000); // out[3] change
  const real = legacyBuf(tx);

  const G = Buffer.concat([gTxidInternal, u32(gVout)]);                   // 36B token_id anchor
  const Mopnt = Buffer.concat([mTxidInternal, VOUT0_LE]);                 // 36B (M at vout 0)
  const tokenNote = out(1000, tokenSpk), stateOut = out(0, st);
  const feeOut = out(50000, feeSpk), changeOut = out(5000, changeSpk);
  const recon = Buffer.concat([HDR_G, Mopnt, genMid(G), tokenNote, stateOut, feeOut, changeOut, LOCKTIME0]);

  assert.equal(genMid(G).length, 47, 'genMid must be 47B');
  assert.ok(recon.equals(real), `genesis reconstruction mismatch:\n recon=${recon.toString('hex')}\n real =${real.toString('hex')}`);
  // the note's stateOut starts at prelenGen(G)
  const off = prelenGen(G);
  assert.ok(real.subarray(off, off + 43).equals(stateOut), `stateOut not at derived genesis offset ${off}`);
  // G appears in the reconstruction at the vin1 outpoint slot (the genesis recognition anchor)
  const gOff = HDR_G.length + 36 + VINTAIL.length; // after HDR_G ‖ Mopnt ‖ M-tail
  assert.ok(real.subarray(gOff, gOff + 36).equals(G), 'G not at the vin1 outpoint slot');
  assert.ok(hash256(recon).equals(hash256(real)), 'hash256 mismatch');
});
