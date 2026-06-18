// P4 SPLIT indexer — recognize a divisible split + credit each child BIND-not-DECLARE (verify each amount against its on-chain
// stateOut + Σ == the spent note's amount), and reject inflation / tampered amounts / token-valued change. Pure/off-chain.
// Run: node --test native/p4/split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeState, encodeAmount, tokenId } from '../wire.mjs';
import { isSplitTransferShape, splitCandidatesFromWitness, splitCreditAmounts, splitDegree } from './splitPredicates.mjs';

const S = bells.crypto.sha256, enc = bells.script.number.encode, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const transferSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const G = tokenId({ genesisTxidInternal: S(Buffer.from([0x99])), genesisVout: 0 });
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const limbPairs = (v) => { const w = []; for (let i = 0; i < N; i++) { const b = Number((BigInt(v) >> BigInt(8 * i)) & 0xffn); w.push(enc(b), Buffer.from([b])); } return w; };

const p2wpkh = (f) => Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, f)]); // a 22B SPK (NON-34B change)
// build a split tx (interleaved [tokenOut_j, stateOut_j] + change) with the splitFullOps witness ABI on vin0.
function splitTx(children, { changeIsToken = false, changeShort = false, tamperCandidate } = {}) {
  const M = children.length;
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x01])), 0, 0xffffffff);
  for (const c of children) { tx.addOutput(transferSPK, c.satValue); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeShort ? p2wpkh(0x88) : (changeIsToken ? transferSPK : changeSPK), 9000);
  // witness: [ownerIn, sig, P, c1, c3, c5, c7, c8, c9, outpoint, ownSPK, changeValue, (owner_j, value_j)*, limbs*, tgt*]
  const pad = (n) => Buffer.alloc(n, 0);
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const w = [pad(20), pad(64), pad(32), pad(9), pad(32), pad(32), pad(5), pad(32), pad(5), pad(36), transferSPK, u64(9000)];
  for (const c of children) w.push(c.owner, u64(c.satValue));
  for (let j = 0; j < M; j++) {
    const amt = tamperCandidate && tamperCandidate.j === j ? tamperCandidate.amount : children[j].amount;
    w.push(...limbPairs(amt));
  }
  w.push(...limbPairs(children.reduce((a, c) => a + c.amount, 0n)));
  tx.ins[0].witness = [...w, Buffer.from([0x51]), Buffer.from([0xc0])]; // + leaf, controlBlock placeholders
  return tx;
}

const kids = [{ amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), satValue: 40000 }, { amount: 14_000_000n, owner: Buffer.alloc(20, 0xb0), satValue: 40000 }];
const spent = { tokenId: G, amount: 21_000_000n };

test('P4 split: isSplitTransferShape recognizes a 2-way split (vin1, vout 2M+1, interleaved)', () => {
  const tx = splitTx(kids);
  assert.equal(isSplitTransferShape(tx, transferSPK), true);
  assert.equal(splitDegree(tx), 2);
});

test('P4 split: credit each child BIND-not-DECLARE (amounts re-derived + verified vs stateOut, Σ == spent)', () => {
  const tx = splitTx(kids);
  const cands = splitCandidatesFromWitness(tx);
  assert.equal(cands.length, 2);
  assert.equal(cands[0].amount, 7_000_000n); assert.equal(cands[1].amount, 14_000_000n);
  const children = splitCreditAmounts(tx, spent, cands);
  assert.ok(children, 'a conserving split must credit its children');
  assert.equal(children[0].amount, 7_000_000n); assert.equal(children[1].amount, 14_000_000n);
  assert.equal(children[0].vout, 0); assert.equal(children[1].vout, 2);
});

test('P4 split RED: a tampered candidate amount (≠ its stateOut commitment) is FULL_IGNORE', () => {
  const tx = splitTx(kids, { tamperCandidate: { j: 0, amount: 7_000_001n } }); // witness says 7M+1, stateOut still commits 7M
  const cands = splitCandidatesFromWitness(tx);
  assert.equal(splitCreditAmounts(tx, spent, cands), null, 'candidate amount must reproduce the stateOut hash or be ignored');
});

test('P4 split RED: inflation (Σ children ≠ spent.amount) is FULL_IGNORE', () => {
  const tx = splitTx(kids);
  const cands = splitCandidatesFromWitness(tx);
  assert.equal(splitCreditAmounts(tx, { tokenId: G, amount: 21_000_001n }, cands), null, 'Σ != spent must be ignored');
});

test('P4 split RED: token-valued change (change SPK == transferSPK) is NOT a recognized split (RED-3b)', () => {
  const tx = splitTx(kids, { changeIsToken: true });
  assert.equal(isSplitTransferShape(tx, transferSPK), false, 'a covenant-SPK change must break recognition (would be an unbound note)');
});

test('P4 split RED: a NON-34B change SPK is NOT a recognized split (FUND-CRITICAL: such children are unspendable under lineage v2)', () => {
  const tx = splitTx(kids, { changeShort: true }); // 22B P2WPKH change
  assert.equal(isSplitTransferShape(tx, transferSPK), false, 'a non-34B change must break recognition (lineage-v2 parent reconstruct needs 0x22‖34B)');
});
