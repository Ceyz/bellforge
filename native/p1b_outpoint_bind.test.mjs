// P1b — bind the SPENT OUTPOINT on-chain. The covenant computes sha_prevouts = SHA256(outpoint)
// from a witness-supplied outpoint and uses it as the c2 component of the reconstructed sighash;
// the CSFS+CHECKSIG binding then forces that outpoint to be the REAL one being spent (a lied
// outpoint → reconstructed sighash ≠ real → CSFS fails). This is the link between the sighash and
// backtrace: it proves WHICH prev tx (txid) is being spent, so P1a's hash256 check can't be pointed
// at a fake tx. (SECURITY_PLAN.md §0 category (b)→(c) bridge.)
//
// Run (regtest node up): node --test p1b_outpoint_bind.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, notMinable } from '../canaries/tap.mjs';
import { nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u32, TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP1b SKIPPED — ${skip}\n`);

const O = bells.opcodes;
const OP_CHECKSIGFROMSTACK = 0xcc;
const FUND = toSats(1), FEE = 10000;

// Witness (deepest→top): [c1=pre, outpoint(36), c3=shaAmounts, c4=shaScriptPubKeys, c5=shaSequences,
//   c6=shaOutputs, c7=mid, c8=leafHash, c9=post, P, sig]. The covenant computes c2 = SHA256(outpoint).
function buildP1bScript() {
  const prefix = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, Buffer.from([0x00])]);
  return bells.script.compile([
    O.OP_TOALTSTACK, O.OP_TOALTSTACK,                 // sig, P -> alt
    O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, O.OP_CAT, // c3..c9 -> acc (7 items, 6 cats)
    O.OP_TOALTSTACK,                                  // acc -> alt ; stack [c1, outpoint]
    O.OP_SHA256,                                      // c2 = SHA256(outpoint) ; stack [c1, c2]
    O.OP_FROMALTSTACK,                                // acc ; stack [c1, c2, acc]
    O.OP_CAT, O.OP_CAT,                               // c1 ‖ c2 ‖ acc = message
    prefix, O.OP_SWAP, O.OP_CAT, O.OP_SHA256,         // computed_sighash
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,             // P, sig
    ...CSFS_PUBKEY_SIG_PINS,                           // pin |P|==32, |sig|==64 (consensus; BIP-342 footgun)
    O.OP_DUP, O.OP_TOALTSTACK, O.OP_OVER, O.OP_TOALTSTACK,
    O.OP_ROT, O.OP_ROT,
    OP_CHECKSIGFROMSTACK, O.OP_VERIFY,                // CSFS bind (computed sighash)
    O.OP_FROMALTSTACK, O.OP_FROMALTSTACK,
    O.OP_SWAP, O.OP_CHECKSIG,                         // CHECKSIG bind (real sighash)
  ]);
}

function buildSpend({ cov, fundTxid, vout, outpoint, dest }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(fundTxid, 'hex').reverse(), vout, 0xffffffff);
  tx.addOutput(dest, FUND - FEE);
  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: fundTxid, vout, value: FUND, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: FUND - FEE, script: dest }],
  });
  const { pre, mid, post } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [FUND], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const priv = Buffer.alloc(32, 0x2b);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  // c2 is computed by the covenant from `outpoint`; we pass outpoint (36B) where c2 sat in B1.
  const witnessData = [pre, outpoint, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, parts.shaOutputs, mid, leafHash, post, P, sig];
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('P1b: covenant binds the REAL spent outpoint (computed sha_prevouts); a lied outpoint is rejected', { skip }, async () => {
  const cov = makeCovenantRaw(buildP1bScript());
  console.log(`\nP1b covenant addr: ${cov.address} (leaf ${cov.leaf.length}B)`);
  const f = await fund(cov);
  const dest = await destSpk();
  const realOutpoint = Buffer.concat([Buffer.from(f.fundTxid, 'hex').reverse(), u32(f.vout)]); // 36B

  // Lied outpoint (flip a byte) -> computed sha_prevouts ≠ real -> reconstructed sighash ≠ real -> CSFS fails.
  const lied = Buffer.from(realOutpoint); lied[0] ^= 0xff;
  const liedHex = buildSpend({ cov, fundTxid: f.fundTxid, vout: f.vout, outpoint: lied, dest });
  const reason = await expectReject(liedHex);
  console.log(`P1b lied-outpoint rejected (mempool): ${reason}`);
  assert.match(reason, /Schnorr|signature|verify|false/i, `unexpected: ${reason}`);
  const lm = await notMinable(liedHex); // N6: outpoint binding must hold at CONSENSUS, not just policy
  assert.equal(lm.mined, false, 'P1b lied-outpoint MUST be rejected at CONSENSUS (generateblock)');
  console.log(`P1b lied-outpoint rejected at CONSENSUS: ${lm.error}`);

  // Real outpoint -> binding holds -> accepted.
  const { txid, confirmations } = await expectAccept(buildSpend({ cov, fundTxid: f.fundTxid, vout: f.vout, outpoint: realOutpoint, dest }));
  assert.ok(confirmations >= 1, 'outpoint-bind spend not confirmed');
  console.log(`P1b confirmed: ${txid} (${confirmations} conf) — the spent outpoint is bound on-chain\n`);
});
