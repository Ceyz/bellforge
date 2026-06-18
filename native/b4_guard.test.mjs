// B4 (on-chain) — conservation guard: a transfer to two committed recipients must conserve the
// total (a1 + a2 == T). The spender picks the split. A non-conserving split is rejected.
//
// Run (regtest node up): node --test b4_guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u32 } from './sighashParts.mjs';
import { buildB4Script, committedRest } from './b4Covenant.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nB4 SKIPPED — ${skip}\n`);

const FUND = toSats(1);                 // 100,000,000-sat guard UTXO
const FEE = 10000;
const T = FUND - FEE;                   // committed total to conserve = 99,990,000 (< 2^31)

function buildSpend({ cov, fundTxid, vout, owner0, owner1, a1, a2 }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(fundTxid, 'hex').reverse(), vout, 0xffffffff);
  tx.addOutput(owner0, a1);
  tx.addOutput(owner1, a2);
  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: fundTxid, vout, value: FUND, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: a1, script: owner0 }, { value: a2, script: owner1 }],
  });
  const { pre, mid, post, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [FUND], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const priv = Buffer.alloc(32, 0x24);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  // a1/a2 as 4-byte LE (both the value-low-4-bytes AND the OP_ADD operands)
  const witnessData = [pre, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, mid, leafHash, post, u32(a1), u32(a2), P, sig];
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('B4: conservation guard — a1+a2==T accepted (free split), non-conserving rejected', { skip }, async () => {
  const owner0 = await destSpk();
  const owner1 = await destSpk();
  const Tbuf = bells.script.number.encode(T);
  const cov = makeCovenantRaw(buildB4Script(committedRest(owner0), committedRest(owner1), Tbuf));
  console.log(`\nB4 guard addr: ${cov.address} (leaf ${cov.leaf.length}B, T=${T})`);

  const f = await fund(cov, 1);
  assert.equal(f.valueSats, FUND);
  const base = { cov, fundTxid: f.fundTxid, vout: f.vout, owner0, owner1 };

  // Non-conserving: a1+a2 = T-1 (1 token vanishes) -> OP_EQUALVERIFY fails.
  const reason = await expectReject(buildSpend({ ...base, a1: 40_000_000, a2: 59_989_999 }));
  console.log(`B4 non-conserving split rejected as expected: ${reason}`);
  assert.match(reason, /EQUALVERIFY|equal|false|stack|verify/i, `unexpected: ${reason}`);

  // Conserving: a1+a2 = T, an arbitrary split -> accepted.
  const { txid, confirmations } = await expectAccept(buildSpend({ ...base, a1: 40_000_000, a2: 59_990_000 }));
  assert.ok(confirmations >= 1, 'conserving transfer not confirmed');
  console.log(`B4 conserving transfer confirmed: ${txid} (${confirmations} conf) — Σ outputs == T enforced on-chain\n`);
});
