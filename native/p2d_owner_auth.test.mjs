// P2-2 (on-chain) — OWNER-AUTH WELDED INTO THE CONSERVATION GATE. The P1d covenant + ownerAuth=true forces the
// CSFS+CHECKSIG binding key P to be the BACKTRACE-PROVEN input owner (hash160(P)==owner_in). So the single (sig,P)
// that introspects the sighash ALSO authorizes as the owner — only the current owner's private key can spend, AND the
// transfer still conserves the amount. This is the fund-safety keystone (C2) composed with conservation, toward P1e-3.
// (GPT-validated: P is no longer ephemeral, it IS the owner key.) Run (regtest up): node --test p2d_owner_auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, fund, destSpk, expectReject, expectAccept, tapLeafHash, toSats, WALLET, notMinable } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u32, u64, varslice } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { buildP2dScript, p2dOps } from './p1dCovenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-2 SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256;
const FUND = toSats(1), FEE = 10000;
const xonly = (priv) => Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);

function buildPrevTx(stateHash) { // synthetic input prev-tx committing the input state (vout[1] = canonical stateOut)
  const version = u32(2), vinCount = Buffer.from([0x01]);
  const input = Buffer.concat([Buffer.alloc(32, 0x77), u32(0), Buffer.from([0x00]), Buffer.from('ffffffff', 'hex')]);
  const voutCount = Buffer.from([0x02]);
  const tokenScript = Buffer.alloc(22, 0x51);
  const out0 = Buffer.concat([u64(12345n), Buffer.from([tokenScript.length]), tokenScript]);
  const stateScript = Buffer.concat([Buffer.from([0x6a, 0x20]), stateHash]);
  const out1 = Buffer.concat([u64(0n), Buffer.from([stateScript.length]), stateScript]);
  const full = Buffer.concat([version, vinCount, input, voutCount, out0, out1, u32(0)]);
  return { full, out1Start: 4 + 1 + input.length + 1 + out0.length };
}

// `signPriv` = the key used for the binding (P + sig). Owner-auth passes iff hash160(xonly(signPriv)) == ownerIn.
function buildSpend({ cov, f, tid, committedTxid, pre, post, ownerIn, outOwner, tIn, signPriv, simCheck = false }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(f.fundTxid, 'hex').reverse(), f.vout, 0xffffffff);
  const outState = encodeState({ tokenId: tid, amount: tIn, owner: outOwner }); // conserves (tOut == tIn)
  const out0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), S(outState)]);
  const changeVal = f.valueSats - FEE;
  const dest = cov.dest;
  tx.addOutput(out0Script, 0);
  tx.addOutput(dest, changeVal);

  const leafHash = tapLeafHash(cov.leaf);
  const parts = sighashComponents({
    inputs: [{ txid: f.fundTxid, vout: f.vout, value: f.valueSats, spk: cov.output, sequence: 0xffffffff }],
    outputs: [{ value: 0, script: out0Script }, { value: changeVal, script: dest }],
  });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [cov.output], [f.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  assert.ok(sighash.equals(real), 'reassembled sighash != belcoinjs sighash');

  const P = xonly(signPriv);
  const sig = Buffer.from(ecc.signSchnorr(real, signPriv)); // the owner (or thief) signs the REAL sighash
  const out1 = Buffer.concat([u64(changeVal), varslice(dest)]);
  const amountInSer = encodeAmount(tIn);
  const witnessData = [sig, P, c1, parts.shaPrevouts, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, c7, leafHash, c9, out1, outOwner, post, pre, amountInSer, ownerIn];

  if (simCheck) {
    const r = runScript(p2dOps({ tokenId: tid, preLen: pre.length, committedTxid }), witnessData, real);
    assert.ok(r.ok, 'stack simulator rejected the honest owner-authorized spend');
  }
  tx.ins[0].witness = [...witnessData, cov.leaf, cov.controlBlock];
  return tx.toHex();
}

test('P2-2: only the backtrace-proven OWNER key can spend the conservation gate; a thief (right amount, wrong key) is rejected', { skip }, async () => {
  const tid = tokenId({ genesisTxidInternal: Buffer.alloc(32, 0x09), genesisVout: 1 });
  const ownerPriv = Buffer.alloc(32, 0x42);
  const ownerHash = bells.crypto.hash160(xonly(ownerPriv)); // the input owner committed in the prev-tx state
  const attackerPriv = Buffer.alloc(32, 0x99);
  const outOwner = Buffer.alloc(20, 0xb2); // recipient (the owner transfers the note onward)
  const tIn = 1_000_000n;

  // synthetic input prev-tx committing {amount: tIn, owner: ownerHash} -> committedTxid (leaf constant; isolation)
  const inState = encodeState({ tokenId: tid, amount: tIn, owner: ownerHash });
  const { full: prevTx, out1Start } = buildPrevTx(S(inState));
  const committedTxid = bells.crypto.hash256(prevTx);
  const pre = prevTx.subarray(0, out1Start);
  const post = prevTx.subarray(out1Start + 43);

  const cov = makeCovenantRaw(buildP2dScript({ tokenId: tid, preLen: pre.length, committedTxid }));
  cov.dest = await destSpk();
  console.log(`\nP2-2 owner-auth+conservation addr: ${cov.address} (leaf ${cov.leaf.length}B)`);
  const base = { cov, tid, committedTxid, pre, post, ownerIn: ownerHash, outOwner, tIn };

  // RED — THEFT: a non-owner conserves the amount and signs with THEIR key. The binding holds for their own (sig,P),
  // but hash160(P_attacker) != owner_in (the proven owner) -> OP_EQUALVERIFY fails -> reject at CONSENSUS.
  const f1 = await fund(cov, 1);
  const theftHex = buildSpend({ ...base, f: f1, signPriv: attackerPriv });
  const r = await expectReject(theftHex);
  console.log(`P2-2 thief (wrong key) rejected (mempool): ${r}`);
  assert.match(r, /EQUALVERIFY|equal|verify|false/i, `unexpected: ${r}`);
  const m = await notMinable(theftHex);
  assert.equal(m.mined, false, 'a non-owner spend MUST be rejected at CONSENSUS (owner-auth)');
  console.log(`P2-2 thief rejected at CONSENSUS: ${m.error}`);

  // GREEN — the OWNER reveals their key as P and signs the real sighash with their private key.
  const f2 = await fund(cov, 1);
  const okHex = buildSpend({ ...base, f: f2, signPriv: ownerPriv, simCheck: true });
  const { txid, confirmations } = await expectAccept(okHex);
  assert.ok(confirmations >= 1, 'owner-authorized conserving transfer not confirmed');
  console.log(`P2-2 owner-authorized transfer confirmed: ${txid} (${confirmations} conf) — only the owner key spends + amount conserved\n`);
});
