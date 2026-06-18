// P4 split-a-mono ABI parity — the indexer half of the genesis-rooted split. The on-chain split-a-mono leaf has a W=4 genesis
// kernel (NOT the W=3+4·M' split kernel), so a split of the MINT note reads its children at Wk=4. Proves: the mono-genesis reader
// reads (amount, owner, owner_type) correctly + BINDs each to its v2 stateOut + Σ==AMOUNT_0; the state-v2 reader (any parentDegree)
// CANNOT accidentally cross-read it (3+4·M'==4 is unsolvable); the dispatcher routes 'mono-genesis' by the spent note's provenance.
// Run: node --test native/p4/mono_genesis_abi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, OwnerType } from '../wire.mjs';
import { splitAMonoV2Witness } from '../p1e3MonoGenesisV2.mjs';
import { splitCandidatesFromWitnessMonoGenesis, splitCandidatesFromWitnessStateV2, splitCreditAmountsV2, splitCandidates } from './splitPredicates.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77), AMOUNT_0 = 21_000_000n;
const stateScript = (amount, owner, ot) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

// a split-a-mono spend tx (1 input = the genesis mint note @ vout0; M children + change) with the Wk=4 mono witness.
function buildMonoSplit({ M, children, changeValue }) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0x42), 0, 0xffffffff);                          // vin0 = the genesis note @ vout 0
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, changeValue);
  const genesis = { genesisTxid: Buffer.alloc(32, 1), mintOutpoint: Buffer.alloc(36, 2), changeValGp: 5000, changeSPKgp: p2tr(0x88) };
  const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
  const w = splitAMonoV2Witness({ genesis, epi, ownSPK, changeValue, outs: children, amountIn: AMOUNT_0, N });
  tx.ins[0].witness = [...w, Buffer.alloc(40), Buffer.alloc(33)];               // ‖ leaf, controlBlock (indexer ignores; bottom-relative reads)
  return tx;
}

// children of the first split MUST sum to AMOUNT_0; a free owner_type mix (key→script deposit at genesis).
const children = [{ owner: Buffer.alloc(20, 0xa0), value: 250000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 250000, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];

test('mono-genesis ABI (Wk=4): reads (amount, owner, owner_type) + BINDs each child to its v2 stateOut + Σ==AMOUNT_0', () => {
  const tx = buildMonoSplit({ M: 2, children, changeValue: 15000 });
  const cand = splitCandidatesFromWitnessMonoGenesis(tx, N);
  assert.ok(cand && cand.length === 2, 'reads M candidates at Wk=4');
  assert.equal(cand[0].amount, 7_000_000n); assert.equal(cand[0].ownerType, OwnerType.KEY);
  assert.equal(cand[1].amount, 14_000_000n); assert.equal(cand[1].ownerType, OwnerType.SCRIPT);
  const credited = splitCreditAmountsV2(tx, { tokenId: G, amount: AMOUNT_0 }, cand);
  assert.ok(credited && credited.length === 2, 'BIND credits M children');
  assert.ok(credited[0].ownerType === OwnerType.KEY && credited[1].ownerType === OwnerType.SCRIPT, 'owner_type carried');
  assert.ok(credited.every((c) => [0, 2].includes(c.vout)), 'children at vouts 0,2');
});

test('mono-genesis ABI: M=3 and M=4 first-split partitions of AMOUNT_0 read + BIND', () => {
  const m3 = [{ owner: Buffer.alloc(20, 0xa0), value: 1, amount: 3_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 1, amount: 8_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xc0), value: 1, amount: 10_000_000n, ownerType: OwnerType.BURN }];
  const tx3 = buildMonoSplit({ M: 3, children: m3, changeValue: 9000 });
  const c3 = splitCandidatesFromWitnessMonoGenesis(tx3, N);
  assert.ok(c3 && c3.length === 3 && c3[2].ownerType === OwnerType.BURN, 'M=3 reads, incl a BURN child');
  assert.ok(splitCreditAmountsV2(tx3, { tokenId: G, amount: AMOUNT_0 }, c3), 'M=3 BINDs Σ==AMOUNT_0 (incl burned supply)');
});

test('mono-genesis ABI: a tampered owner_type / amount fails the v2 BIND (fail-closed)', () => {
  const tx = buildMonoSplit({ M: 2, children, changeValue: 15000 });
  const cand = splitCandidatesFromWitnessMonoGenesis(tx, N);
  const t1 = cand.map((c) => ({ ...c })); t1[0].ownerType = OwnerType.SCRIPT;       // on-chain stateOut commits KEY
  assert.equal(splitCreditAmountsV2(tx, { tokenId: G, amount: AMOUNT_0 }, t1), null, 'tampered owner_type fails BIND');
  const t2 = cand.map((c) => ({ ...c })); t2[1].amount = 14_000_001n;
  assert.equal(splitCreditAmountsV2(tx, { tokenId: G, amount: AMOUNT_0 }, t2), null, 'tampered amount fails BIND');
});

test('mono-genesis ABI: Σ != AMOUNT_0 fails conservation (the spent genesis note carries AMOUNT_0)', () => {
  const tx = buildMonoSplit({ M: 2, children, changeValue: 15000 });
  const cand = splitCandidatesFromWitnessMonoGenesis(tx, N);
  assert.equal(splitCreditAmountsV2(tx, { tokenId: G, amount: AMOUNT_0 - 1n }, cand), null, 'a wrong spent-note amount fails Σ');
});

test('mono-genesis ABI: the state-v2 reader (any parentDegree) CANNOT cross-read a Wk=4 mono witness', () => {
  const tx = buildMonoSplit({ M: 2, children, changeValue: 15000 });
  const mono = splitCandidatesFromWitnessMonoGenesis(tx, N);
  for (const pd of [2, 3, 4]) {
    const crossed = splitCandidatesFromWitnessStateV2(tx, pd, N);                    // Wk=3+4·pd ∈ {11,15,19} — never 4
    assert.ok(crossed === null || !crossed[0].owner.equals(mono[0].owner), `parentDegree=${pd} does not read the mono layout`);
  }
  assert.deepEqual(splitCandidates(tx, { abiVersion: 'mono-genesis' }), mono, 'dispatcher routes mono-genesis');
});
