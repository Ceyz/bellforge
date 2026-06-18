// P1a (building block) — backtrace core: a covenant reassembles a previous transaction from
// relay-standard witness chunks (<=80 bytes each) and verifies hash256(reassembled) == a committed
// txid. This is THE primitive of backtrace (prove which prev tx you're spending). In full P1 the
// committed value = the spent outpoint's txid bound via the sighash; here we prove the
// chunked-reassembly + double-SHA256 mechanism in isolation against a realistic tx-sized blob.
//
// Run (regtest node up): node --test p1a_backtrace_hash.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenantRaw, fund, destSpk, spendHex, expectReject, expectAccept } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP1a SKIPPED — ${skip}\n`);

const O = bells.opcodes;

// Covenant: spendable iff hash256( OP_CAT(c0,c1,c2) ) == committedTxid. Witness supplies c0,c1,c2.
function buildBacktraceScript(committedTxid) {
  return bells.script.compile([
    O.OP_CAT, O.OP_CAT,            // reassemble prevTx = c0‖c1‖c2 (right-to-left: c0 deepest)
    O.OP_SHA256, O.OP_SHA256,      // hash256 = txid (internal byte order)
    committedTxid, O.OP_EQUAL,     // == the committed prev-tx txid
  ]);
}

test('P1a: covenant verifies a prev-tx reassembled from <=80B chunks hashes to its txid', { skip }, async () => {
  // A realistic ~200-byte "previous transaction" blob, split into relay-standard <=80B witness chunks.
  const prevTx = Buffer.concat([Buffer.alloc(80, 0x11), Buffer.alloc(80, 0x22), Buffer.alloc(40, 0x33)]);
  const c = [prevTx.subarray(0, 80), prevTx.subarray(80, 160), prevTx.subarray(160, 200)];
  for (const ch of c) assert.ok(ch.length <= 80, 'chunk exceeds 80-byte standard tapscript item');
  const txid = bells.crypto.hash256(prevTx); // SHA256(SHA256(prevTx)) = the txid (internal order)

  const cov = makeCovenantRaw(buildBacktraceScript(txid));
  console.log(`\nP1a covenant addr: ${cov.address} (leaf ${cov.leaf.length}B)`);
  const f = await fund(cov);
  const dest = await destSpk();
  const base = { fundTxid: f.fundTxid, vout: f.vout, valueSats: f.valueSats, destSpk: dest, cov };

  // Wrong prev-tx (flip a byte in c1) -> hash256 mismatch -> reject.
  const bad = [c[0], Buffer.from(c[1]), c[2]]; bad[1][0] ^= 0xff;
  const reason = await expectReject(spendHex({ ...base, witnessData: bad }));
  console.log(`P1a wrong prev-tx rejected: ${reason}`);
  assert.match(reason, /false|equal|stack|verify/i, `unexpected: ${reason}`);

  // Correct chunks -> hash256(reassembled) == committed txid -> accept.
  const { txid: spendTxid, confirmations } = await expectAccept(spendHex({ ...base, witnessData: c }));
  assert.ok(confirmations >= 1, 'backtrace-hash spend not confirmed');
  console.log(`P1a confirmed: ${spendTxid} (${confirmations} conf) — covenant reassembled prevTx from chunks + verified its txid\n`);
});
