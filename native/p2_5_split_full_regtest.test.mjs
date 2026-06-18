// P2-5 FULL leaf at CONSENSUS — a divisible SPLIT (1 note → M child notes) with the c6=sha_outputs bind + real Schnorr. The
// covenant builds amount_ser_j single-source, reconstructs the M-way c6, and CSFS+CHECKSIG FORCE c6 == the REAL tx shaOutputs,
// so each child note's stateOut commits exactly its share and Σ shares == the input amount. Mirrors the N9 5/5 gate.
// Run (regtest up): node --test native/p2_5_split_full_regtest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { makeCovenantRaw, makeCovenant, fund, expectAccept, notMinable, tapLeafHash, WALLET } from '../canaries/tap.mjs';
import { rpc, nodeReachable } from '../canaries/rpc.mjs';
import { sighashComponents, reassembleSighash, u64, varslice } from './sighashParts.mjs';
import { encodeState, encodeAmount, tokenId } from './wire.mjs';
import { splitFullOps, buildSplitFullLeaf } from './p2_5Covenant.mjs';
import { runScript } from './scriptsim.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason}). See docs/REGTEST.md`;
if (skip) console.log(`\nP2-5 full split regtest SKIPPED — ${skip}\n`);

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, O = bells.opcodes, N = 8;
const enc = bells.script.number.encode;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const stateScript = (G, amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const limbs = (v) => { const a = []; for (let i = 0; i < N; i++) a.push(Number((BigInt(v) >> BigInt(8 * i)) & 0xffn)); return a; };
const limbPairs = (v) => { const L = limbs(v); const w = []; for (let i = 0; i < N; i++) w.push(enc(L[i]), Buffer.from([L[i]])); return w; };

// G = a real consumed genesis outpoint (OP_TRUE, mini — no lineage); changeSPK distinct from the covenant.
const changeSPK = p2tr(0x77);

// Build + (sim then) broadcast a split: spend `note` into M child notes (amount_j, owner_j) + change, key-owned by `priv`.
async function trySplit({ cov, ownSPK, G, note, children, changeValue, priv, mutate, amountInOverride, expectSim }) {
  const M = children.length;
  const P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1);
  const owner_in = H160(P);
  const leafHash = tapLeafHash(cov.leaf);
  const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : children.reduce((a, c) => a + c.amount, 0n);

  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(note.fundTxid, 'hex').reverse(), note.vout, 0xffffffff);
  const outs = [];
  for (const c of children) { outs.push({ value: c.satValue, script: ownSPK }); outs.push({ value: 0, script: stateScript(G, c.amount, c.owner) }); }
  outs.push({ value: changeValue, script: changeSPK });
  for (const o of outs) tx.addOutput(o.script, o.value);

  const parts = sighashComponents({ inputs: [{ txid: note.fundTxid, vout: note.vout, value: note.valueSats, spk: ownSPK, sequence: 0xffffffff }], outputs: outs });
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const real = tx.hashForWitnessV1(0, [ownSPK], [note.valueSats], bells.Transaction.SIGHASH_DEFAULT, leafHash);
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const noteOutpoint = Buffer.concat([Buffer.from(note.fundTxid, 'hex').reverse(), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(note.vout); return b; })()]);

  // witness (deepest→top) matching splitFullOps' abs layout
  const w = [owner_in, sig, P, c1, parts.shaAmounts, parts.shaSequences, c7, leafHash, c9, noteOutpoint, ownSPK, u64(changeValue)];
  for (const c of children) w.push(c.owner, u64(c.satValue));
  for (const c of children) w.push(...limbPairs(c.amount));
  w.push(...limbPairs(amountIn));
  if (mutate) mutate(w);

  if (expectSim !== undefined) {
    let ok; try { ok = runScript(splitFullOps(M, N, { tokenId: G, changeSPK }).ops, w, real).ok; } catch { ok = false; }
    assert.equal(ok, expectSim, `scriptsim prediction ${ok} != ${expectSim}`);
  }
  tx.ins[0].witness = [...w, cov.leaf, cov.controlBlock];
  return tx;
}

test('P2-5 FULL: a 2-way divisible split is ACCEPTED at CONSENSUS with real Schnorr (c6 bound to the real shaOutputs)', { skip }, async () => {
  const M = 2;
  const opTrue = makeCovenant([O.OP_TRUE]);
  const gf = await fund(opTrue, 1);
  const G = tokenId({ genesisTxidInternal: Buffer.from(gf.fundTxid, 'hex').reverse(), genesisVout: gf.vout });
  const cov = makeCovenantRaw(buildSplitFullLeaf(M, N, { tokenId: G, changeSPK }));
  const ownSPK = cov.output;
  console.log(`\nP2-5 full leaf ${cov.address} (${cov.leaf.length}B)`);
  const note = await fund(cov, 1); // the note to split (token amount = 21,000,000)
  const priv = Buffer.alloc(32, 0x0b);
  const children = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const changeValue = note.valueSats - 80000 - 20000;

  const tx = await trySplit({ cov, ownSPK, G, note, children, changeValue, priv, expectSim: true });
  const acc = await expectAccept(tx.toHex());
  assert.ok(acc.confirmations >= 1, 'split not confirmed');
  console.log(`  GREEN: split 21M -> [7M, 14M] confirmed ${acc.txid} — each child stateOut binds its share, Σ == input`);

  // RED — INFLATION: claim the input is 21M but the children sum to 21M+1 (over-issue)
  const note2 = await fund(cov, 1);
  const inflated = [{ amount: 7_000_001n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
  const txR = await trySplit({ cov, ownSPK, G, note: note2, children: inflated, changeValue, priv, amountInOverride: 21_000_000n, expectSim: false });
  assert.equal((await notMinable(txR.toHex())).mined, false, 'Σ children > input must be rejected at block-validation');
  console.log('  RED inflation (Σ children > input): rejected at block-validation');

  // RED — THIEF: a non-owner key (hash160(P') != owner_in path is fine, but owner-auth pins hash160(P)==owner_in; a wrong key
  // gives a sig the node will reject under CHECKSIG over the real sighash) -> use a different priv whose P still hashes... the
  // owner_in is derived from THIS priv's P, so a mismatched-sig attack = corrupt the sig.
  const note3 = await fund(cov, 1);
  // (no scriptsim assertion: scriptsim models CHECKSIG structurally — only the real node verifies the Schnorr signature)
  const txT = await trySplit({ cov, ownSPK, G, note: note3, children, changeValue, priv, mutate: (w) => { w[1] = Buffer.alloc(64, 0x00); } });
  assert.equal((await notMinable(txT.toHex())).mined, false, 'a bad signature must be rejected (owner-auth + CHECKSIG)');
  console.log('  RED bad-sig: rejected at block-validation');
  console.log('\n✅ P2-5 FULL: divisible split with the c6=sha_outputs bind enforced at CONSENSUS with real Schnorr.\n');
});
