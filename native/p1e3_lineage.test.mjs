// LAYER 2 scriptsim test — continuation lineage: prove the grandparent txGP (hash256(txGP)‖00 == vin0_outpoint,
// txGP.out0 == ownSPK, txGP token_id == G). No node. Run: node --test p1e3_lineage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64, u32 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { VOUT0_LE, PRELEN_CONT } from './p1e3Const.mjs';
import { p1e3TxGPLineageOps } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const G = Buffer.concat([Buffer.alloc(32, 0x6e), u32(0)]);

// Build a real grandparent txGP (mono-input, 3 outputs) + the witness for the lineage check.
function fixture({ amtGP = 12345n, ownerGP = Buffer.alloc(20, 0x99), out0Spk = null, tokenIdGP = G, valGP = 1000 } = {}) {
  const ownSPK = p2tr(0x11);                                          // the covenant SPK we EXPECT at txGP.out0
  const realOut0 = out0Spk ?? ownSPK;                                // the spk the REAL txGP.out0 carries
  const ggTxid = S(B(0x67, 0x67));                                   // great-grandparent txid
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(ggTxid, 0, 0xffffffff);
  tx.addOutput(realOut0, valGP);                                     // out0 tokenOut
  const stateGP = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: tokenIdGP, amount: amtGP, owner: ownerGP }))]);
  tx.addOutput(stateGP, 0);                                          // out1 stateOut
  tx.addOutput(p2tr(0x55), 4321);                                    // out2 change
  const buf = tx.toBuffer();
  const vin0_outpoint = Buffer.concat([hash256(buf), VOUT0_LE]);     // = (txGP_txid, 0): what txP.vin[0] would point at
  const tailGP = buf.subarray(PRELEN_CONT + 43);
  const vinGP_outpoint = Buffer.concat([ggTxid, VOUT0_LE]);
  // witness deepest->top: [vin0_outpoint, tailGP, vinGP_outpoint, valGP, ownSPK, ownerGP, amtGP]
  return { ownSPK, witness: [vin0_outpoint, tailGP, vinGP_outpoint, u64(valGP), ownSPK, ownerGP, u64(amtGP)] };
}

test('LAYER 2 GREEN: a real covenant grandparent passes the lineage check', () => {
  const f = fixture();
  const r = runScript(p1e3TxGPLineageOps({ tokenId: G }), f.witness, null);
  assert.ok(r.ok, `expected GREEN; main=${r.main.map((x) => x.toString('hex'))}`);
});

test('LAYER 2 RED: txGP.output[0].spk != ownSPK (forged continuation) -> reject', () => {
  // real txGP.out0 is an attacker P2TR; the covenant rebuilds tokenOut0_GP from ownSPK -> hash256(txGP) != vin0_outpoint.
  const f = fixture({ out0Spk: p2tr(0xaa) });
  const r = runScript(p1e3TxGPLineageOps({ tokenId: G }), f.witness, null);
  assert.equal(r.ok, false, 'a grandparent whose out0 is not the covenant must NOT pass continuation');
});

test('LAYER 2 RED: txGP token_id = G\' != G (cross-token graft) -> reject', () => {
  const Gprime = Buffer.concat([Buffer.alloc(32, 0xfe), u32(0)]);
  const f = fixture({ tokenIdGP: Gprime });
  const r = runScript(p1e3TxGPLineageOps({ tokenId: G }), f.witness, null);
  assert.equal(r.ok, false, 'a grandparent carrying a different token_id must NOT pass continuation');
});

test('LAYER 2 RED: wrong vin0_outpoint (decoy) -> reject', () => {
  const f = fixture();
  const w = [...f.witness];
  w[0] = Buffer.concat([S(B(0xde, 0xad)), VOUT0_LE]); // a vin0_outpoint that is not hash256(txGP)
  const r = runScript(p1e3TxGPLineageOps({ tokenId: G }), w, null);
  assert.equal(r.ok, false, 'the grandparent identity must equal txP.vin[0]');
});
