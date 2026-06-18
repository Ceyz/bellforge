// P2-5 LINEAGE v2 — the FULL composed split-child leaf (Step 6a, MINUS grandparent). scriptsim with a byte-exact sighash:
// build a REAL split parent txP (the spent note = child j), build a REAL "spend child j → M new children" tx, compute its
// tapscript sighash off-chain (sighashParts), and run the leaf through scriptsim with that sighash as the CSFS expected message.
// scriptsim's CSFS asserts the leaf's assembled message == the real sighash ⟹ it verifies c2 (position-aware), c4, and the
// M-way c6 are all byte-exact, PLUS the conservation (Σ children == backtrace-proven amount_in) + owner-auth (hash160(P)==proven
// owner_in) run on the real arithmetic. Run: node --test native/p1e3_split_full_lineage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageOps, splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const N = 8;
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK };
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);

// P = a fixed 32B "pubkey" (scriptsim checks |P|==32 + computes hash160(P) for owner-auth; the Schnorr is structural).
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c);
const owner_in = H160(P);

// a REAL degree-Mp split parent txP; child j has (amount=amountIn, owner=owner_in, value=jValueSats). Returns the kernel-witness
// `parent` object + committedTxidP/vin0Outpoint + child j's sat value (the spent note's value).
function buildTxP(Mp, j, amountIn, jValueSats, changeVal) {
  const children = Array.from({ length: Mp }, (_, k) => ({
    value: k === j ? jValueSats : 50000 + 1000 * k,
    amount: k === j ? amountIn : BigInt(3_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k),
  }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);            // txP.vin0 = the grandparent pointer
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, changeVal);
  const legacy = tx.toBuffer();
  return {
    committedTxidP: hash256(legacy),
    vin0Outpoint: legacy.subarray(5, 41),
    jValueSats,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) },
  };
}

// assemble + scriptsim a "spend child j → M new children" tx. outs = current children [{owner, value(sats), amount(bigint)}].
function trySpend({ Mp, j, M, txp, outs, changeValue, amountInOverride }) {
  const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a);                       // scriptsim: any consistent 32B (real tapleaf hash on the node)
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const vout = 2 * j;

  // the current tx outputs: interleaved [tokenOut_j' @ 2j', stateOut_j' @ 2j'+1] + changeOut @ 2M
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner) }); }
  outputs.push({ value: changeValue, script: changeSPK });

  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });

  const w = splitFullLineageWitness({
    parent: txp.parent,
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs, amountIn, N,
  });
  return runScript(splitFullLineageOps(Mp, j, M, N, consts).ops, w, sighash);
}
const rejects = (args) => { try { trySpend(args); return false; } catch { return true; } };

test('lineage-v2 FULL (no grandparent) GREEN: spend split-child j → 2 new children; c2/c4/c6 byte-exact, Σ==amount_in, owner-auth', () => {
  for (const j of [0, 1]) {
    const txp = buildTxP(2, j, 21_000_000n, 100000, 9000);
    const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n }];
    const r = trySpend({ Mp: 2, j, M: 2, txp, outs, changeValue: 15000 });
    assert.ok(r.ok, `child ${j}: leaf returns OP_1 (cleanstack) — c2 position-aware + c6 + conservation + owner-auth all pass`);
  }
});

test('lineage-v2 FULL leaf size (M\'=2, M=2..4) is reported (taptree/relay budget)', () => {
  for (const M of [2, 3, 4]) {
    const leaf = bells.script.compile(splitFullLineageOps(2, 0, M, N, consts).ops);
    console.log(`  lineage-v2 full leaf M'=2 j=0 M=${M}: ${leaf.length}B`);
    assert.ok(leaf.length > 0);
  }
});

test('lineage-v2 FULL RED inflation: Σ children > backtrace-proven amount_in rejects (conservation)', () => {
  const txp = buildTxP(2, 1, 21_000_000n, 100000, 9000);
  // children sum to 21M+1, but amount_in (parked from txP) is 21M -> the weld forces target==21M, Σ != target -> PHASE A reject.
  const inflated = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_001n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n }];
  assert.ok(rejects({ Mp: 2, j: 1, M: 2, txp, outs: inflated, changeValue: 15000, amountInOverride: 21_000_000n }), 'inflation rejects');
});

test('lineage-v2 FULL RED forged-target: a target ≠ backtrace-proven amount_in rejects (Step-5 weld)', () => {
  const txp = buildTxP(2, 0, 21_000_000n, 100000, 9000);
  // children honestly sum to 21M, but claim amount_in target = 20M (forge) -> the weld CAT(8 tgt_ser)==amount_in(21M) fails.
  const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n }];
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, txp, outs, changeValue: 15000, amountInOverride: 20_000_000n }), 'forged target rejects at the weld');
});

test('lineage-v2 FULL RED wrong-owner: owner-auth hash160(P) != backtrace-proven owner_in rejects', () => {
  // txP's child j owner is set to a DIFFERENT hash than hash160(P) -> owner-auth EQUALVERIFY fails.
  const Mp = 2, j = 0, amountIn = 21_000_000n;
  const children = Array.from({ length: Mp }, (_, k) => ({ value: k === j ? 100000 : 51000, amount: k === j ? amountIn : 3_000_000n, owner: Buffer.alloc(20, 0xee) })); // child j owner = 0xee.. != hash160(P)
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(Buffer.from([0x42])), 0, 0xffffffff);
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  const txp = { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), jValueSats: 100000,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) } };
  const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n }];
  assert.ok(rejects({ Mp, j, M: 2, txp, outs, changeValue: 15000 }), 'wrong owner_in rejects at owner-auth');
});
