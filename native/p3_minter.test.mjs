// P3 v1 (on-chain) — CLOSED ONE-SHOT GENESIS MINTER. The mint = spending the minter covenant UTXO in a 2-input tx
// [minter@M, G] that emits the FROZEN output vector [tokenNote0, stateOut0, feeOut, change]. token_id=G is required
// (sha_prevouts=SHA256(M‖G)); the output vector is fully enumerated from leaf constants (no free tail) → over-cap and
// fee-bypass are impossible; one-shot (G spent once). (docs/MINTER_DESIGN.md; operator-set supply, trustless after.)
// Run (regtest up): node --test p3_minter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenant, makeCovenantRaw, fund, expectReject, expectAccept, tapLeafHash, toSats, WALLET, notMinable } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u32, u64, varslice } from './sighashParts.mjs';
import { encodeState, tokenId } from './wire.mjs';
import { p3MinterOps, buildP3MinterScript } from './p3MinterCovenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP3 SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256;
const O = bells.opcodes;
const FEE = 10000;
const outpointOf = (txid, vout) => Buffer.concat([Buffer.from(txid, 'hex').reverse(), u32(vout)]);
const p2tr = (fill) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, fill)]);

// Build the mint tx. `mode`: 'honest' | 'overcap' | 'feeabsent' | 'gmissing'. Returns hex (+ sim-checks honest).
function buildMint({ minterCov, mf, gCov, gf, K, simCheck = false, mode = 'honest' }) {
  const tx = new bells.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(mf.fundTxid, 'hex').reverse(), mf.vout, 0xffffffff);            // vin[0] = minter UTXO
  const gOut = mode === 'gmissing' ? { txid: K.decoyTxid, vout: K.decoyVout, val: K.decoyVal } : { txid: gf.fundTxid, vout: gf.vout, val: gf.valueSats };
  tx.addInput(Buffer.from(gOut.txid, 'hex').reverse(), gOut.vout, 0xffffffff);             // vin[1] = G (or a decoy)

  const changeVal = mf.valueSats + gOut.val - Number(K.VALUE_0) - Number(K.F) - FEE;
  tx.addOutput(K.transferSPK, Number(K.VALUE_0));   // out[0] token note
  tx.addOutput(K.stateScript0, 0);                  // out[1] stateOut (OP_RETURN, value 0)
  if (mode !== 'feeabsent') tx.addOutput(K.feeSPK, Number(K.F)); // out[2] fee
  tx.addOutput(K.changeSPK, changeVal);             // change (last)
  if (mode === 'overcap') tx.addOutput(K.transferSPK, Number(K.VALUE_0)); // an extra token note appended (the free-tail attack)

  const inSpks = [minterCov.output, gCov.output];
  const inVals = [mf.valueSats, gOut.val];
  const leafHash = tapLeafHash(minterCov.leaf);
  const parts = sighashComponents({
    inputs: [
      { txid: mf.fundTxid, vout: mf.vout, value: mf.valueSats, spk: minterCov.output, sequence: 0xffffffff },
      { txid: gOut.txid, vout: gOut.vout, value: gOut.val, spk: gCov.output, sequence: 0xffffffff },
    ],
    outputs: tx.outs.map((o) => ({ value: o.value, script: o.script })),
  });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ version: 2, locktime: 0, inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, inSpks, inVals, bells.Transaction.SIGHASH_DEFAULT, leafHash);

  const priv = Buffer.alloc(32, 0x5e);
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const M = outpointOf(mf.fundTxid, mf.vout);
  const changeValBuf = u64(changeVal);
  const witnessData = [c1, parts.shaAmounts, parts.shaScriptPubKeys, parts.shaSequences, c7, leafHash, c9, changeValBuf, K.changeSPK, M, P, sig];

  if (simCheck) {
    const r = runScript(p3MinterOps({ tokenId: K.tokenId, tokenOut0: K.tokenOut0, stateOut0: K.stateOut0, feeOut: K.feeOut, changeSpkLen: 34 }), witnessData, real);
    assert.ok(r.ok, 'stack simulator rejected the honest mint');
  }
  tx.ins[0].witness = [...witnessData, minterCov.leaf, minterCov.controlBlock];
  tx.ins[1].witness = [gCov.leaf, gCov.controlBlock]; // G is OP_TRUE (anyone-can-spend), no sig
  return tx.toHex();
}

test('P3 v1: closed one-shot mint — honest accepted; over-cap / fee-absent / G-missing rejected at CONSENSUS', { skip }, async () => {
  // G = a pre-existing OP_TRUE UTXO; token_id = G's outpoint.
  const gCov = makeCovenant([O.OP_TRUE]);
  const gf = await fund(gCov, 1);
  const G = outpointOf(gf.fundTxid, gf.vout);
  const tid = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  assert.ok(G.equals(tid), 'token_id must equal G outpoint');

  // FROZEN leaf-constant outputs (operator-set supply): one note + its stateOut + the exact fee.
  const transferSPK = p2tr(0xc1);          // per-token transfer covenant SPK (placeholder for the canary)
  const VALUE_0 = 1000n, AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0xd1);
  const tokenOut0 = Buffer.concat([u64(VALUE_0), varslice(transferSPK)]);
  const stateScript0 = Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: tid, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const stateOut0 = Buffer.concat([u64(0n), varslice(stateScript0)]);
  const F = 50000n, feeSPK = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0xe1)]); // operator fee output (P2WPKH)
  const feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
  const changeSPK = p2tr(0xf1);

  const minterCov = makeCovenantRaw(buildP3MinterScript({ tokenId: tid, tokenOut0, stateOut0, feeOut, changeSpkLen: 34 }));
  console.log(`\nP3 minter addr: ${minterCov.address} (leaf ${minterCov.leaf.length}B) token_id=${tid.toString('hex').slice(0, 16)}…`);
  const K = { tokenId: tid, transferSPK, VALUE_0, F, stateScript0, feeSPK, changeSPK, tokenOut0, stateOut0, feeOut };

  // a decoy UTXO (for the G-missing red): another OP_TRUE fund
  const decoy = await fund(gCov, 1);
  K.decoyTxid = decoy.fundTxid; K.decoyVout = decoy.vout; K.decoyVal = decoy.valueSats;

  // RED — OVER-CAP (free-tail attack): append an extra token note. Real sha_outputs has 5 outputs; covenant rebuilds 4 → reject.
  const mf1 = await fund(minterCov, 1);
  const oc = buildMint({ minterCov, mf: mf1, gCov, gf, K, mode: 'overcap' });
  await expectReject(oc); assert.equal((await notMinable(oc)).mined, false, 'over-cap must be rejected at CONSENSUS');
  console.log('P3 over-cap (free-tail) rejected at CONSENSUS ✓');

  // RED — FEE ABSENT: omit the fee output → covenant rebuilds c6 WITH feeOut, real omits it → reject.
  const mf2 = await fund(minterCov, 1);
  const fa = buildMint({ minterCov, mf: mf2, gCov, gf, K, mode: 'feeabsent' });
  await expectReject(fa); assert.equal((await notMinable(fa)).mined, false, 'fee-absent must be rejected at CONSENSUS');
  console.log('P3 fee-absent rejected at CONSENSUS ✓');

  // RED — G MISSING (forged genesis / double-mint class): vin[1] = a decoy, not G → sha_prevouts != SHA256(M‖G) → reject.
  const mf3 = await fund(minterCov, 1);
  const gm = buildMint({ minterCov, mf: mf3, gCov, gf, K, mode: 'gmissing' });
  await expectReject(gm); assert.equal((await notMinable(gm)).mined, false, 'G-missing must be rejected at CONSENSUS');
  console.log('P3 G-missing (forged genesis) rejected at CONSENSUS ✓');

  // GREEN — honest mint: spend the minter + consume G, emit the frozen output vector.
  const mf4 = await fund(minterCov, 1);
  const ok = buildMint({ minterCov, mf: mf4, gCov, gf, K, simCheck: true, mode: 'honest' });
  const { txid, confirmations } = await expectAccept(ok);
  assert.ok(confirmations >= 1, 'honest mint not confirmed');
  console.log(`P3 honest mint confirmed: ${txid} (${confirmations} conf) — cap+fee enforced by construction, token_id=G anchored\n`);
});
