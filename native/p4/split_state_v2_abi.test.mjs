// P2-0 BRICK 0 (indexer half) — the STATE-v2 split BIND. The on-chain v2 leaf commits encodeStateV2 (66B owner_type); the off-chain
// indexer MUST reproduce the SAME 66B preimage or it false-rejects every v2 split (the critic's CRITICAL "indexer wired to v1"
// trap). Proves: splitCandidatesFromWitnessStateV2 reads (amount, owner, owner_type) at the state-v2 ABI + splitCreditAmountsV2
// BINDs each child to its v2 stateOut + Σ==spent.amount + carries owner_type; the v1/state-v1 readers MIS-READ a v2 witness.
// Run: node --test native/p4/split_state_v2_abi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, encodeAmount, OwnerType } from '../wire.mjs';
import { splitFullLineageV2Witness } from '../p1e3SplitFullLineageV2.mjs';
import { isSplitTransferShape, splitCandidatesFromWitnessStateV2, splitCreditAmountsV2, splitCandidatesFromWitness, splitCandidates } from './splitPredicates.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

// build a state-v2 split spend tx (M children at ownSPK + interleaved v2 stateOuts + change) + its state-v2 witness.
function buildV2Split({ Mp, j, children, changeValue }) {
  const amountIn = children.reduce((a, c) => a + c.amount, 0n);
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 2 * j, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: Mp }, (_, k) => ({ value: 100000 + k, amountSer: encodeAmount(BigInt(3_000_000 * (k + 1))), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
  const w = splitFullLineageV2Witness({ parent, epi, ownSPK, changeValue, outs: children, amountIn, N });
  tx.ins[0].witness = [...w, Buffer.alloc(40), Buffer.alloc(33)];
  return { tx, amountIn };
}

const children = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }];

test('state-v2 ABI: reads (amount, owner, owner_type) + BINDs each child to its v2 stateOut + Σ==spent.amount', () => {
  const Mp = 2;
  const { tx, amountIn } = buildV2Split({ Mp, j: 1, children, changeValue: 15000 });
  assert.ok(isSplitTransferShape(tx, ownSPK), 'recognized as a split');
  const cand = splitCandidatesFromWitnessStateV2(tx, Mp, N);
  assert.ok(cand && cand.length === 2, 'reads M candidates');
  assert.equal(cand[0].amount, 5_000_000n); assert.equal(cand[0].ownerType, OwnerType.KEY);
  assert.equal(cand[1].amount, 9_000_000n); assert.equal(cand[1].ownerType, OwnerType.SCRIPT);
  const credited = splitCreditAmountsV2(tx, { tokenId: G, amount: amountIn }, cand);
  assert.ok(credited && credited.length === 2, 'BIND credits M children');
  assert.ok(credited[0].ownerType === OwnerType.KEY && credited[1].ownerType === OwnerType.SCRIPT, 'owner_type carried onto each child');
  assert.ok(credited.every((c) => [0, 2].includes(c.vout)), 'children at vouts 0,2');
});

test('state-v2 ABI: a tampered owner_type / amount fails the v2 BIND (fail-closed)', () => {
  const { tx, amountIn } = buildV2Split({ Mp: 2, j: 1, children, changeValue: 15000 });
  const cand = splitCandidatesFromWitnessStateV2(tx, 2, N);
  // claim child0 is SCRIPT while its on-chain stateOut commits KEY -> the v2 preimage hash differs -> BIND null.
  const tampered = cand.map((c) => ({ ...c })); tampered[0].ownerType = OwnerType.SCRIPT;
  assert.equal(splitCreditAmountsV2(tx, { tokenId: G, amount: amountIn }, tampered), null, 'tampered owner_type fails BIND');
  const t2 = cand.map((c) => ({ ...c })); t2[0].amount = 5_000_001n;
  assert.equal(splitCreditAmountsV2(tx, { tokenId: G, amount: amountIn }, t2), null, 'tampered amount fails BIND');
});

test('state-v2 ABI: the v1/state-v1 readers MIS-READ a state-v2 witness (the false-HALT the version-gate prevents)', () => {
  const { tx } = buildV2Split({ Mp: 2, j: 1, children, changeValue: 15000 });
  // the v1-mini reader (12-relative) lands on the wrong slots -> wrong/non-20B owner -> null (or different from the v2 read).
  const v1 = splitCandidatesFromWitness(tx, N);
  const v2 = splitCandidatesFromWitnessStateV2(tx, 2, N);
  assert.ok(v2 && v2[0].ownerType === OwnerType.KEY, 'state-v2 reads correctly');
  assert.ok(v1 === null || !v1[0].owner.equals(v2[0].owner), 'v1-mini reader does not match the v2 read');
  // the dispatcher routes by abiVersion.
  assert.deepEqual(splitCandidates(tx, { abiVersion: 'state-v2', parentDegree: 2 }), v2);
});

test('state-v2 ABI: M\'=3/4 parent degrees shift the offsets (Wk = 3 + 4·M\')', () => {
  for (const Mp of [3, 4]) {
    const { tx, amountIn } = buildV2Split({ Mp, j: 0, children, changeValue: 15000 });
    const cand = splitCandidatesFromWitnessStateV2(tx, Mp, N);
    assert.ok(cand && cand[0].amount === 5_000_000n && cand[1].amount === 9_000_000n, `M'=${Mp} reads correctly`);
    assert.ok(splitCreditAmountsV2(tx, { tokenId: G, amount: amountIn }, cand), `M'=${Mp} BINDs`);
  }
});
