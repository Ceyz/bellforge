// P2-1 (on-chain) — OWNER-AUTH: only the holder of the owner's PRIVATE key can spend a token note.
// The covenant commits owner = hash160(P_owner); a spend must reveal P_owner and sign with it. A thief who
// uses their OWN key (different pubkey) fails the hash160 check; revealing the real pubkey with a bad sig fails
// CHECKSIG. This is the branch that makes a token NON-STEALABLE — the fund-safety keystone P1d/P1e lack.
//
// Run (regtest up): node --test p2_owner_auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { buildOwnerAuthScript } from './p2Covenant.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-1 SKIPPED — ${skip}\n`);

const FUND = toSats(1), FEE = 10000;
const xonly = (priv) => Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1); // 32B x-only pubkey

// Spend builder: reveal `revealPub`, sign the real tapscript sighash with `signPriv`.
function buildSpend({ cov, f, dest, revealPub, signPriv }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(f.fundTxid, 'hex').reverse(), f.vout, 0xffffffff);
  tx.addOutput(dest, f.valueSats - FEE);
  const leafHash = tapLeafHash(cov.leaf);
  const sighash = tx.hashForWitnessV1(0, [cov.output], [f.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(sighash, signPriv)); // 64B SIGHASH_DEFAULT
  tx.ins[0].witness = [sig, revealPub, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

async function minable(hex) { // generateblock validates under CONSENSUS rules
  const addr = await rpc('getnewaddress', ['', 'bech32m'], { wallet: WALLET });
  try { await rpc('generateblock', [addr, [hex], true], { wallet: WALLET }); return { mined: true }; }
  catch (e) { return { mined: false, error: e.message.split(':').slice(-1)[0].trim() }; }
}

test('P2-1: only the owner key can spend — a thief (wrong key) and a bad signature are rejected', { skip }, async () => {
  const ownerPriv = Buffer.alloc(32, 0x42);
  const ownerPub = xonly(ownerPriv);
  const committedOwner = bells.crypto.hash160(ownerPub); // 20B — the on-chain owner commitment
  const attackerPriv = Buffer.alloc(32, 0x99);
  const attackerPub = xonly(attackerPriv);

  const cov = makeCovenantRaw(buildOwnerAuthScript(committedOwner));
  console.log(`\nP2-1 owner-auth addr: ${cov.address} (leaf ${cov.leaf.length}B)`);
  const dest = await destSpk();

  // RED — THEFT: attacker reveals THEIR pubkey + signs with their key. hash160(attackerPub) != committedOwner -> reject.
  const f1 = await fund(cov, 1);
  const theftHex = buildSpend({ cov, f: f1, dest, revealPub: attackerPub, signPriv: attackerPriv });
  const r1 = await expectReject(theftHex);
  console.log(`P2-1 thief (wrong key) rejected (mempool): ${r1}`);
  assert.match(r1, /EQUALVERIFY|equal|verify|false/i, `unexpected: ${r1}`);
  const m1 = await minable(theftHex);
  assert.equal(m1.mined, false, 'a non-owner key MUST be rejected at CONSENSUS (anti-theft)');
  console.log(`P2-1 thief rejected at CONSENSUS (block-level): ${m1.error}`);

  // RED — bad signature: reveal the REAL owner pubkey, but sign with the attacker's key -> CHECKSIG fails.
  const f2 = await fund(cov, 1);
  const badSigHex = buildSpend({ cov, f: f2, dest, revealPub: ownerPub, signPriv: attackerPriv });
  const r2 = await expectReject(badSigHex);
  console.log(`P2-1 right-pubkey + bad-sig rejected: ${r2}`);
  assert.match(r2, /Schnorr|signature|verify|false/i, `unexpected: ${r2}`);

  // GREEN — the owner reveals their pubkey and signs with their private key.
  const f3 = await fund(cov, 1);
  const okHex = buildSpend({ cov, f: f3, dest, revealPub: ownerPub, signPriv: ownerPriv });
  const { txid, confirmations } = await expectAccept(okHex);
  assert.ok(confirmations >= 1, 'owner-authorized spend not confirmed');
  console.log(`P2-1 owner-authorized spend confirmed: ${txid} (${confirmations} conf) — only the owner key spends\n`);
});
