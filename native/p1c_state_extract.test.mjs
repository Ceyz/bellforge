// P1c (building block) — extract the prev-tx OP_RETURN token STATE by RECONSTRUCTION, not parsing
// (no OP_SUBSTR on Bellscoin). Given the real prev-txid (from P1b in full P1), the covenant proves the
// spent UTXO's committed token amount+owner as follows: it receives `amount_ser`(8B)+`owner`(20B) as
// witness, rebuilds the FROZEN state = 0x01 ‖ token_id ‖ amount_ser ‖ owner (65B, wire.mjs), hashes it,
// and reconstructs the CANONICAL 43-byte state output:
//     value(8 = 0x00·8) ‖ scriptlen(0x22) ‖ OP_RETURN(0x6a) ‖ PUSH32(0x20) ‖ sha256(state)(32)
// It splices that covenant-BUILT stateOut into the prev-tx as [pre ‖ stateOut ‖ post], reuses P1a's
// hash256(reassembled)==committedTxid, AND pins `pre` to a constant length so the state output can only
// sit at the committed vout (fixed-vout pin). A LIED amount → different stateHash → reassembled ≠ real →
// hash mismatch → reject. So a spender cannot claim a fake input token amount. (SECURITY_PLAN §7 P1c; GPT A2.)
// Multi-chunk reassembly of a >80B `pre` is P1a's job; here `pre` is a single ≤80B chunk to isolate the
// NEW mechanism (stateOut reconstruction + splice). Mono-output model — one token output, one state
// OP_RETURN at a constant vout (the multi-output state-root is a tracked production item, SECURITY_PLAN §7).
//
// Run (regtest node up): node --test p1c_state_extract.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenantRaw, fund, destSpk, spendHex, expectReject, expectAccept, notMinable } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { encodeState, encodeAmount, STATE_VERSION, tokenId } from './wire.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP1c SKIPPED — ${skip}\n`);

const O = bells.opcodes;
const S = bells.crypto.sha256;
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// Build a realistic (non-witness) prev-tx serialization whose vout[1] is the canonical state OP_RETURN.
// txid = hash256(this serialization). Sized so `pre` (everything before vout[1]) is a single ≤80B chunk.
function buildPrevTx(stateHash) {
  const version = u32le(2);
  const vinCount = Buffer.from([0x01]);
  const input = Buffer.concat([Buffer.alloc(32, 0x77), u32le(0), Buffer.from([0x00]), Buffer.from('ffffffff', 'hex')]); // 41B
  const voutCount = Buffer.from([0x02]);
  const tokenScript = Buffer.alloc(22, 0x51);                                 // a 22B token output script (opaque here)
  const out0 = Buffer.concat([u64le(12345n), Buffer.from([tokenScript.length]), tokenScript]); // 8+1+22 = 31B
  const stateScript = Buffer.concat([Buffer.from([0x6a, 0x20]), stateHash]);  // OP_RETURN PUSH32 hash (34B)
  const out1 = Buffer.concat([u64le(0n), Buffer.from([stateScript.length]), stateScript]); // 8+1+34 = 43B = stateOut
  const locktime = u32le(0);
  const full = Buffer.concat([version, vinCount, input, voutCount, out0, out1, locktime]);
  const out1Start = version.length + vinCount.length + input.length + voutCount.length + out0.length; // 4+1+41+1+31 = 78
  return { full, out1Start, out1 };
}

// Covenant constants: token_id (36B), the state-output FRAME, the prefix length pin, and the committed txid.
// Witness (deepest→top): [post, pre, amount_ser, owner].
function buildP1cScript({ tokenId: tid, frame, preLen, committedTxid }) {
  const VTI = Buffer.concat([Buffer.from([STATE_VERSION]), tid]); // 0x01 ‖ token_id (37B)
  return bells.script.compile([
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,            // owner, amount_ser -> alt ; stack [post, pre]
    O.OP_SIZE, Buffer.from([preLen]), O.OP_EQUALVERIFY, // fixed-vout pin: |pre| == committed prefix length
    VTI,                                         // [post, pre, 0x01‖token_id]
    O.OP_FROMALTSTACK, O.OP_CAT,                 // ‖ amount_ser   -> [post, pre, VTI‖amount_ser]
    O.OP_FROMALTSTACK, O.OP_CAT,                 // ‖ owner        -> [post, pre, state(65)]
    O.OP_SHA256,                                 // [post, pre, stateHash]
    frame, O.OP_SWAP, O.OP_CAT,                  // FRAME ‖ stateHash -> [post, pre, stateOut(43)]
    O.OP_CAT,                                     // pre ‖ stateOut  -> [post, pre‖stateOut]
    O.OP_SWAP, O.OP_CAT,                          // (pre‖stateOut) ‖ post -> [prevTx]
    O.OP_SHA256, O.OP_SHA256,                     // hash256 = txid
    committedTxid, O.OP_EQUAL,                    // == the committed prev-tx txid
  ]);
}

test('P1c: covenant reconstructs the canonical state OP_RETURN + verifies it in the prev-tx; a lied amount is rejected', { skip }, async () => {
  const tid = tokenId({ genesisTxidInternal: Buffer.alloc(32, 0x09), genesisVout: 1 }); // 36B
  const owner = Buffer.alloc(20, 0xbb);
  const realAmount = 1_000_000n;

  // The real state (frozen wire format) and the prev-tx that commits it.
  const state = encodeState({ tokenId: tid, amount: realAmount, owner }); // 65B
  const stateHash = S(state);
  const { full, out1Start, out1 } = buildPrevTx(stateHash);
  const committedTxid = bells.crypto.hash256(full); // SHA256(SHA256(prevTx)) — internal byte order
  const FRAME = Buffer.concat([Buffer.alloc(8, 0), Buffer.from([0x22, 0x6a, 0x20])]); // value(0)‖len(34)‖OP_RETURN‖PUSH32
  assert.ok(out1.equals(Buffer.concat([FRAME, stateHash])), 'state output != FRAME‖stateHash (43B canonical)');

  const pre = full.subarray(0, out1Start);
  const post = full.subarray(out1Start + 43);
  assert.ok(pre.length <= 80 && post.length <= 80, 'pre/post must be relay-standard ≤80B items (P1c-minimal)');

  const cov = makeCovenantRaw(buildP1cScript({ tokenId: tid, frame: FRAME, preLen: pre.length, committedTxid }));
  console.log(`\nP1c covenant addr: ${cov.address} (leaf ${cov.leaf.length}B, |pre|=${pre.length})`);
  const f = await fund(cov);
  const dest = await destSpk();
  const base = { fundTxid: f.fundTxid, vout: f.vout, valueSats: f.valueSats, destSpk: dest, cov };

  // Lied amount -> covenant builds a different stateHash -> reassembled prevTx ≠ real -> hash256 mismatch -> reject.
  const liedAmount = encodeAmount(realAmount + 1n);
  const liedHex = spendHex({ ...base, witnessData: [post, pre, liedAmount, owner] });
  const reason = await expectReject(liedHex);
  console.log(`P1c lied-amount rejected (mempool): ${reason}`);
  assert.match(reason, /false|equal|stack|verify/i, `unexpected: ${reason}`);
  const lm = await notMinable(liedHex); // N6: the false-amount proof must be rejected at CONSENSUS, not just policy
  assert.equal(lm.mined, false, 'P1c lied-amount MUST be rejected at CONSENSUS (generateblock)');
  console.log(`P1c lied-amount rejected at CONSENSUS: ${lm.error}`);

  // Real amount + owner -> reconstructed stateOut matches the prev-tx -> hash256 == txid -> accept.
  const amountSer = encodeAmount(realAmount);
  const { txid, confirmations } = await expectAccept(spendHex({ ...base, witnessData: [post, pre, amountSer, owner] }));
  assert.ok(confirmations >= 1, 'state-extract spend not confirmed');
  console.log(`P1c confirmed: ${txid} (${confirmations} conf) — covenant proved the prev-tx's committed token amount on-chain\n`);
});
