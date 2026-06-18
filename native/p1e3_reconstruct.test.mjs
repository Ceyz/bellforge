// LAYER 0 scriptsim test — the N9 vout-boundary txP reconstruction kernel (no regtest node needed).
// Proves p1e3ReconstructTxPOps rebuilds a REAL parent tx byte-for-byte from pinned sub-pieces and that hash256(rebuilt)
// == committedTxidP, AND that a wrong amount_in / owner_in / vin0_outpoint breaks the match. Run: node --test p1e3_reconstruct.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { u64, u32 } from './sighashParts.mjs';
import { encodeState } from './wire.mjs';
import { VOUT0_LE, PRELEN_CONT } from './p1e3Const.mjs';
import { p1e3ReconstructTxPOps } from './p1e3Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);

// Build a REAL continuation parent txP (mono-input, 3 outputs) and the witness pieces for the kernel.
function fixture({ amount = 12345n, owner = Buffer.alloc(20, 0x99), gpFill = 0xab, val0 = 1000 } = {}) {
  const G = Buffer.concat([Buffer.alloc(32, 0x6e), u32(0)]);           // token_id (36B)
  const ownSPK = p2tr(0x11);                                          // covenant own SPK (out0)
  // GPT review: use a REAL non-palindrome txid (a hash, not a uniform 0xNN fill) so the test actually exercises
  // byte-order — an endianness bug can hide behind a palindromic 0xab…ab outpoint.
  const gpTxid = S(Buffer.concat([Buffer.from('gp-outpoint-seed'), Buffer.from([gpFill])]));  // 32B, non-palindrome
  const changeSpk = p2tr(0x33);

  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(gpTxid, 0, 0xffffffff);                                 // vin0 = the spent-from grandparent note
  tx.addOutput(ownSPK, val0);                                         // out0 = tokenOut (the note)
  const stateScript = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);
  tx.addOutput(stateScript, 0);                                      // out1 = stateOut
  tx.addOutput(changeSpk, 5000);                                     // out2 = change
  const real = tx.toBuffer();                                        // legacy (no witness) = what hash256 takes for txid
  const committedTxidP = hash256(real);

  const vin0_outpoint = Buffer.concat([gpTxid, VOUT0_LE]);            // 36B
  const tailP = real.subarray(PRELEN_CONT + 43);                     // everything after stateOut_P (out2 ‖ locktime)
  // witness deepest->top: [committedTxidP, tailP, vin0_outpoint, tokenOut0val_P, ownSPK, owner_in, amount_in]
  return { G, ownSPK, committedTxidP, vin0_outpoint, tailP, val0, owner, amount };
}

test('vout-boundary reconstruction GREEN: rebuilds the real txP, hash256 == committedTxidP', () => {
  const f = fixture();
  const w = [f.committedTxidP, f.tailP, f.vin0_outpoint, u64(f.val0), f.ownSPK, f.owner, u64(f.amount)];
  const r = runScript(p1e3ReconstructTxPOps({ tokenId: f.G }), w, null);
  assert.ok(r.ok, `expected GREEN, got main=${r.main.map((x) => x.toString('hex'))} trace tail=${r.trace.slice(-4)}`);
});

test('RED wrong amount_in: reconstruction != committedTxidP', () => {
  const f = fixture();
  const w = [f.committedTxidP, f.tailP, f.vin0_outpoint, u64(f.val0), f.ownSPK, f.owner, u64(99999n)];
  const r = runScript(p1e3ReconstructTxPOps({ tokenId: f.G }), w, null);
  assert.equal(r.ok, false, 'a forged amount_in must NOT reconstruct to committedTxidP');
});

test('RED wrong owner_in: reconstruction != committedTxidP', () => {
  const f = fixture();
  const w = [f.committedTxidP, f.tailP, f.vin0_outpoint, u64(f.val0), f.ownSPK, Buffer.alloc(20, 0x00), u64(f.amount)];
  const r = runScript(p1e3ReconstructTxPOps({ tokenId: f.G }), w, null);
  assert.equal(r.ok, false, 'a forged owner_in must NOT reconstruct');
});

test('RED wrong vin0_outpoint (decoy grandparent pointer): reconstruction != committedTxidP', () => {
  const f = fixture();
  const decoy = Buffer.concat([Buffer.alloc(32, 0xcc), VOUT0_LE]);
  const w = [f.committedTxidP, f.tailP, decoy, u64(f.val0), f.ownSPK, f.owner, u64(f.amount)];
  const r = runScript(p1e3ReconstructTxPOps({ tokenId: f.G }), w, null);
  assert.equal(r.ok, false, 'a decoy vin0_outpoint must NOT reconstruct (it is spliced into the hashed txP)');
});

test('RED non-8B amount_in: OP_SIZE pin rejects (CAT1)', () => {
  const f = fixture();
  const w = [f.committedTxidP, f.tailP, f.vin0_outpoint, u64(f.val0), f.ownSPK, f.owner, Buffer.alloc(7, 0x01)];
  assert.throws(() => runScript(p1e3ReconstructTxPOps({ tokenId: f.G }), w, null), /EQUALVERIFY/);
});

// GPT review #1 — H2 needle-embed against the kernel: even when a forged stateOut (for an inflated amount) is EMBEDDED
// inside another output's pushdata, the kernel reads the amount via the FIXED out1 reconstruction (preLen DERIVED, not a
// sliding witness), so the embedded copy is never honored. Build a real txP whose CHANGE output spk carries the bytes of
// SHA256(state(99999)); then claim amount_in=99999. The kernel rebuilds stateOut_P(99999) at out1 != real out1 -> reject.
test('RED H2 needle-embed: a forged stateOut hidden in the change output is NOT claimable (fixed out1 offset)', () => {
  const G = Buffer.concat([Buffer.alloc(32, 0x6e), u32(0)]);
  const ownSPK = p2tr(0x11);
  const gpTxid = S(Buffer.from('h2-gp-seed'));
  const owner = Buffer.alloc(20, 0x99);
  const forgedHash = S(encodeState({ tokenId: G, amount: 99999n, owner }));    // the inflated note's state hash
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(gpTxid, 0, 0xffffffff);
  tx.addOutput(ownSPK, 1000);                                                  // out0 tokenOut
  const realState = Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount: 12345n, owner }))]);
  tx.addOutput(realState, 0);                                                  // out1 = the REAL stateOut (amount 12345)
  // out2 change: an OP_RETURN that EMBEDS the forged 99999 state hash (the needle a slider would try to claim)
  tx.addOutput(Buffer.concat([B(0x6a, 0x20), forgedHash]), 0);
  const real = tx.toBuffer();
  const committedTxidP = hash256(real);
  const vin0_outpoint = Buffer.concat([gpTxid, VOUT0_LE]);
  const tailP = real.subarray(PRELEN_CONT + 43);

  // attacker claims the inflated amount (its state hash IS present in txP, just not at out1)
  const w = [committedTxidP, tailP, vin0_outpoint, u64(1000), ownSPK, owner, u64(99999n)];
  const r = runScript(p1e3ReconstructTxPOps({ tokenId: G }), w, null);
  assert.equal(r.ok, false, 'an embedded/forged stateOut must NOT be claimable — only the out1-position state counts');
  // and the HONEST amount (12345, the real out1) still reconstructs
  const wok = [committedTxidP, tailP, vin0_outpoint, u64(1000), ownSPK, owner, u64(12345n)];
  assert.ok(runScript(p1e3ReconstructTxPOps({ tokenId: G }), wok, null).ok, 'the real out1 amount must reconstruct');
});
