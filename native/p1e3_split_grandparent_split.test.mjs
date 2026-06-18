// P2-5 LINEAGE v2 — the SPLIT-CHILD grandparent arm (lineage completeness): spend a split-child whose 2-hop ancestor txGP is
// ITSELF a degree-Mp_gp split (the txP-input note @ vout 2j' of txGP). scriptsim with a byte-exact sighash + a REAL split→split
// chain: txGP (a degree-Mp_gp split) → txP (a degree-Mp split spending txGP.out[2j']) → the current "spend child j → M children"
// tx. The arm reconstructs txGP (all 2Mp_gp+1 outputs ownSPK-based) and forces hash256(txGP)‖2j' == txP.vin0_outpoint (j' FORCED
// by the EQUALVERIFY, not a leaf const). Run: node --test native/p1e3_split_grandparent_split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { sighashComponents, reassembleSighash } from './sighashParts.mjs';
import { splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { splitFullLineageSplitGrandparentOps, splitGrandparentSplit } from './p1e3SplitGrandparent.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const consts = { tokenId: G, changeSPK };
const stateScript = (amount, owner) => Buffer.concat([Buffer.from([0x6a, 0x20]), S(encodeState({ tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// txP: a degree-Mp split spending txGP.out[2j'] (vin0 = committedTxidGP ‖ u32le(2j')); child j has (amountIn, owner_in).
function buildTxP(Mp, j, amountIn, committedTxidGP, jprime) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(2_000_000 * (k + 1)), owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k) }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidGP, 2 * jprime, 0xffffffff);          // spend txGP.out[2j']
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) } };
}

function trySpend({ Mp, j, M, Mp_gp, jprime, children, mutatePieces }) {
  const amountIn = children.reduce((a, c) => a + c.amount, 0n);
  const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k) }));
  const gp = splitGrandparentSplit({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x43), jprime, kids, changeValGp: 7000 });
  const committedTxidGP = hash256(gp.txGP);
  const txp = buildTxP(Mp, j, amountIn, committedTxidGP, jprime);
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const c of children) { outputs.push({ value: 40000, script: ownSPK }); outputs.push({ value: 0, script: stateScript(c.amount, c.owner) }); }
  outputs.push({ value: 15000, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: children.map((c) => ({ owner: c.owner, value: 40000, amount: c.amount })), amountIn, N });
  const pieces = gp.pieces.map((b) => Buffer.from(b));
  if (mutatePieces) mutatePieces(pieces);
  return runScript(splitFullLineageSplitGrandparentOps(Mp, j, M, N, Mp_gp, consts), [...w, ...pieces], sighash);
}
const rejects = (a) => { try { return !trySpend(a).ok; } catch { return true; } };

const cur = [{ owner: Buffer.alloc(20, 0xa0), amount: 5_000_000n }, { owner: Buffer.alloc(20, 0xb0), amount: 9_000_000n }]; // Σ=14M

test('split-grandparent GREEN: txGP(split) → txP(split) → spend child j, for Mp_gp∈{2,3,4}, j∈{0..Mp-1}, jprime∈{0..Mp_gp-1}', () => {
  for (const Mp_gp of [2, 3, 4]) for (const j of [0, 1]) for (let jprime = 0; jprime < Mp_gp; jprime++) {
    assert.ok(trySpend({ Mp: 2, j, M: 2, Mp_gp, jprime, children: cur }).ok, `Mp_gp=${Mp_gp} j=${j} j'=${jprime}`);
  }
});

test('split-grandparent RED: a forged txGP (tampered child amount/vin0) breaks hash256(txGP)‖2j\' == txP.vin0', () => {
  // tamper the amountSer of txGP's kid 0 (piece index 4 = value_0, amount_0 @ 5, owner_0 @ 6 ... pieces: [vinGP,changeVal,vout,(value,amount,owner)*])
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, Mp_gp: 2, jprime: 1, children: cur, mutatePieces: (p) => { p[4] = encodeAmount(999n); } }), 'forged txGP amount rejects');
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, Mp_gp: 2, jprime: 1, children: cur, mutatePieces: (p) => { p[0] = Buffer.alloc(36, 0xee); } }), 'forged txGP vin0 rejects');
});

test('split-grandparent RED: a wrong j\' (witness_vout) breaks the outpoint match (position-bound)', () => {
  // jprime=1 in txP.vin0 (vout=2), but claim witness_vout for j'=0 (vout=0) -> hash256(txGP)‖0 != txP.vin0(‖2) -> reject.
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, Mp_gp: 2, jprime: 1, children: cur, mutatePieces: (p) => { p[2] = Buffer.from([0, 0, 0, 0]); } }), 'wrong j\' (vout) rejects');
});

test('split-grandparent leaf sizes (Mp=2,j=0,M=2; Mp_gp=2..4) reported', () => {
  for (const Mp_gp of [2, 3, 4]) {
    const leaf = bells.script.compile(splitFullLineageSplitGrandparentOps(2, 0, 2, N, Mp_gp, consts));
    console.log(`  split-grandparent leaf Mp_gp=${Mp_gp}: ${leaf.length}B`);
    assert.ok(leaf.length > 0);
  }
});
