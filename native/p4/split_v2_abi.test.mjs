// P4 Step 9 — the LINEAGE v2 split witness ABI parity. The position-aware lineage-v2 leaf stacks the txP-reconstruction kernel
// (Wk = 3 + 3·M' items) at the BOTTOM of the witness, so the current children sit at Wk-relative offsets, NOT the v1 (splitFullOps)
// 12-relative ones. This proves: (a) splitCandidatesFromWitnessV2 reads the v2 witness correctly + S3 BINDs it; (b) the v1 reader
// MIS-READS the v2 witness (returns null = the FALSE covenant_escape HALT the version-gate prevents); (c) the dispatcher routes by
// abiVersion. Run: node --test native/p4/split_v2_abi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeState, encodeAmount } from '../wire.mjs';
import { splitFullLineageWitness } from '../p1e3SplitFullLineage.mjs';
import { isSplitTransferShape, splitCandidatesFromWitness, splitCandidatesFromWitnessV2, splitCandidates, splitCreditAmounts } from './splitPredicates.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);

// build a lineage-v2 split spend tx (M children at ownSPK + interleaved stateOuts + change) + its v2 witness (M' = parentDegree).
function buildV2Split({ Mp, j, children, changeValue }) {
  const amountIn = children.reduce((a, c) => a + c.amount, 0n);
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 2 * j, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, changeValue);
  const parent = { committedTxidP: Buffer.alloc(32, 0x01), vin0Outpoint: Buffer.alloc(36, 0x02), changeVal: 5000,
    outputs: Array.from({ length: Mp }, (_, k) => ({ value: 100000 + k, amountSer: encodeAmount(BigInt(3_000_000 * (k + 1))), owner: Buffer.alloc(20, 0xc0 + k) })) };
  const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
  const w = splitFullLineageWitness({ parent, epi, ownSPK, changeValue, outs: children, amountIn, N });
  tx.ins[0].witness = [...w, Buffer.alloc(40), Buffer.alloc(33)]; // + dummy leaf, controlBlock
  return { tx, amountIn };
}

const children = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n }];

test('P4 v2 ABI: splitCandidatesFromWitnessV2 reads the lineage-v2 witness correctly + S3 BINDs Σ==spent.amount', () => {
  const Mp = 2;
  const { tx, amountIn } = buildV2Split({ Mp, j: 1, children, changeValue: 15000 });
  assert.ok(isSplitTransferShape(tx, ownSPK), 'recognized as a split (vin1, vout 2M+1, interleaved, 34B non-covenant change)');
  const cand = splitCandidatesFromWitnessV2(tx, Mp, N);
  assert.ok(cand && cand.length === 2, 'v2 reader returns M candidates');
  for (let k = 0; k < 2; k++) {
    assert.equal(cand[k].amount, children[k].amount, `child ${k} amount`);
    assert.ok(cand[k].owner.equals(children[k].owner), `child ${k} owner`);
  }
  const credited = splitCreditAmounts(tx, { tokenId: G, amount: amountIn }, cand);
  assert.ok(credited && credited.length === 2, 'S3 BIND credits M children');
  assert.ok(credited[0].amount === 5_000_000n && credited[1].amount === 9_000_000n && credited.every((c) => [0, 2].includes(c.vout)), 'children bound at vouts 0,2');
});

test('P4 v2 ABI: the v1 reader MIS-READS a v2 witness (returns null = the false covenant_escape HALT the gate prevents)', () => {
  const { tx } = buildV2Split({ Mp: 2, j: 1, children, changeValue: 15000 });
  const v1 = splitCandidatesFromWitness(tx, N);                  // reads at 12+2j -> lands on c3 (32B), not a 20B owner
  assert.equal(v1, null, 'v1 read of a v2 witness fails-closed (would FALSE-HALT a valid split without the version-gate)');
  const v2 = splitCandidatesFromWitnessV2(tx, 2, N);
  assert.ok(v2 && !v2[0].owner.equals(v1?.[0]?.owner ?? Buffer.alloc(0)), 'v2 read differs from the (failed) v1 read');
});

test('P4 v2 ABI: M\'=3/4 parent degrees shift the offsets correctly (Wk = 3 + 3·M\')', () => {
  for (const Mp of [3, 4]) {
    const { tx, amountIn } = buildV2Split({ Mp, j: 0, children, changeValue: 15000 });
    const cand = splitCandidatesFromWitnessV2(tx, Mp, N);
    assert.ok(cand && cand[0].amount === 5_000_000n && cand[1].amount === 9_000_000n, `M'=${Mp} reads correctly`);
    assert.ok(splitCreditAmounts(tx, { tokenId: G, amount: amountIn }, cand), `M'=${Mp} BINDs`);
    // a WRONG parentDegree shifts every offset -> mis-read -> BIND fails (fail-closed), proving M' must be the real parent degree.
    const wrong = splitCandidatesFromWitnessV2(tx, Mp === 3 ? 4 : 3, N);
    assert.ok(!wrong || !splitCreditAmounts(tx, { tokenId: G, amount: amountIn }, wrong), `wrong M' for ${Mp} does not credit`);
  }
});

test('P4 v2 ABI: the dispatcher routes by abiVersion', () => {
  const { tx } = buildV2Split({ Mp: 2, j: 1, children, changeValue: 15000 });
  assert.deepEqual(splitCandidates(tx, { abiVersion: 'v2-lineage', parentDegree: 2 }), splitCandidatesFromWitnessV2(tx, 2, N));
  assert.equal(splitCandidates(tx, { abiVersion: 'v1-mini' }), null);  // v1 on a v2 witness
  assert.throws(() => splitCandidates(tx, { abiVersion: 'bogus' }), /unknown split witness ABI/);
});
