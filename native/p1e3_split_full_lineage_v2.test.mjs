// P2-0 BRICK 0 — the v2 composed split-child leaf (KEY arm). scriptsim with a byte-exact v2 sighash: spend a KEY-owned split-child
// note → M children with CHOSEN owner_types (incl. a key→SCRIPT deposit). Proves the +1-byte owner_type shift is byte-exact end-to-
// end (c2/c4/c6 + conservation + owner_type_in==KEY gate + per-output owner_type validation + key-auth). Run: node --test native/p1e3_split_full_lineage_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageV2Ops, splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK };
const stateScript = (amount, owner, ownerType) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeStateV2({ ownerType, tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// a v2 split parent txP; child j is KEY-owned (owner_in, amountIn) unless overridden (for the owner_type_in≠KEY RED).
function buildTxP(Mp, j, amountIn, jOwnerType = OwnerType.KEY) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? jOwnerType : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

function trySpend({ Mp, j, M, txp, outs, changeValue, amountInOverride }) {
  const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, outs, amountIn, N });
  return runScript(splitFullLineageV2Ops(Mp, j, M, N, consts).ops, w, sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

// the deposit case: a KEY note split into one KEY child + one SCRIPT child (deposited into a pool).
const outsKeyScript = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];

test('v2 leaf GREEN: spend a KEY split-child → KEY + SCRIPT children (a key→script deposit); c2/c4/c6 byte-exact, owner_type_in==KEY, types validated', () => {
  for (const j of [0, 1]) {
    const txp = buildTxP(2, j, 21_000_000n);
    assert.ok(trySpend({ Mp: 2, j, M: 2, txp, outs: outsKeyScript, changeValue: 15000 }).ok, `child ${j} key→{key,script}`);
  }
});

test('v2 leaf RED owner_type_in≠KEY: spending a SCRIPT-owned note via the KEY leaf rejects (arm selected by committed owner_type)', () => {
  const txp = buildTxP(2, 1, 21_000_000n, OwnerType.SCRIPT); // child 1 is SCRIPT-owned
  assert.ok(rejects({ Mp: 2, j: 1, M: 2, txp, outs: outsKeyScript, changeValue: 15000 }), 'SCRIPT note via KEY leaf rejects');
});

test('v2 leaf RED invalid output owner_type: a child with owner_type=5 rejects (validate ∈ {0,1,2})', () => {
  const txp = buildTxP(2, 0, 21_000_000n);
  const bad = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n, ownerType: 5 }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, txp, outs: bad, changeValue: 15000 }), 'owner_type=5 child rejects');
});

test('v2 leaf RED inflation: Σ children > backtrace-proven amount_in rejects', () => {
  const txp = buildTxP(2, 1, 21_000_000n);
  const inflated = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_001n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];
  assert.ok(rejects({ Mp: 2, j: 1, M: 2, txp, outs: inflated, changeValue: 15000, amountInOverride: 21_000_000n }), 'inflation rejects');
});

test('v2 leaf size (M\'=2, M=2..4) reported', () => {
  for (const M of [2, 3, 4]) {
    const leaf = bells.script.compile(splitFullLineageV2Ops(2, 0, M, N, consts).ops);
    console.log(`  v2 split-child leaf (KEY) M'=2 j=0 M=${M}: ${leaf.length}B`);
    assert.ok(leaf.length > 0);
  }
});
