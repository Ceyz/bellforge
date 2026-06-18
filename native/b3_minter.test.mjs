// B3 — closed minter (fixed-supply) via CTV. The minter UTXO commits (BIP-119) the exact mint
// transaction: the token-note outputs + a token-metadata OP_RETURN. Spending the minter MUST
// produce exactly that distribution; a tampered mint is rejected. (docs/NATIVE_TOKEN.md §3.)
// Reuses the CTV mechanism proven by C2f.
//
// Run (regtest node up): node --test b3_minter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenant, fund, destSpk, expectReject, expectAccept, ctvDefaultHash, toSats } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';

const OP_NOP4 = 0xb3; // OP_CHECKTEMPLATEVERIFY

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nB3 SKIPPED — ${skip}\n`);

// Serialize a tx with the given outputs + the single minter input, ready for sendrawtransaction.
function buildMintTx({ minterTxid, vout, outputs }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(minterTxid, 'hex').reverse(), vout, 0xffffffff);
  for (const o of outputs) tx.addOutput(o.script, o.value);
  return tx;
}

test('B3: closed minter — committed mint distribution accepted, tampered rejected', { skip }, async () => {
  const FUND = toSats(1); // 100,000,000-sat minter UTXO
  const ownerA = await destSpk();
  const ownerB = await destSpk();
  // token metadata in an OP_RETURN: protocol tag + token_id(8) + total_supply(8) (illustrative)
  const meta = bells.script.compile([
    bells.opcodes.OP_RETURN,
    Buffer.concat([Buffer.from('BTKN'), Buffer.alloc(8, 1), Buffer.alloc(8, 0xff)]),
  ]);

  // The committed mint: two token notes (sats carry the note; amount lives in metadata) + metadata OP_RETURN.
  const noteVal = (FUND - 10000) / 2; // leave 10k fee; values are pinned by CTV
  const mintOutputs = [
    { value: noteVal, script: ownerA },
    { value: noteVal, script: ownerB },
    { value: 0, script: meta },
  ];

  const tmpl = ctvDefaultHash({
    version: 2, locktime: 0, sequences: [0xffffffff], outputs: mintOutputs, inputIndex: 0,
  });
  const minter = makeCovenant([tmpl, OP_NOP4]);
  console.log(`\nB3 minter addr: ${minter.address}`);

  const f = await fund(minter, 1);
  assert.equal(f.valueSats, FUND);

  // Tampered mint: shift 1 sat from A to B -> different outputs -> CTV mismatch -> reject.
  const tampered = buildMintTx({
    minterTxid: f.fundTxid, vout: f.vout,
    outputs: [{ value: noteVal - 1, script: ownerA }, { value: noteVal + 1, script: ownerB }, { value: 0, script: meta }],
  });
  tampered.ins[0].witness = [minter.leaf, minter.controlBlock];
  const reason = await expectReject(tampered.toHex());
  console.log(`B3 tampered mint rejected as expected: ${reason}`);
  assert.match(reason, /template|CHECKTEMPLATEVERIFY|false|stack|verify/i, `unexpected: ${reason}`);

  // Correct mint: exactly the committed distribution -> accepted.
  const mint = buildMintTx({ minterTxid: f.fundTxid, vout: f.vout, outputs: mintOutputs });
  mint.ins[0].witness = [minter.leaf, minter.controlBlock];
  const { txid, confirmations } = await expectAccept(mint.toHex());
  assert.ok(confirmations >= 1, 'committed mint not confirmed');
  console.log(`B3 committed mint confirmed: ${txid} (${confirmations} conf) — fixed supply enforced by covenant\n`);
});
