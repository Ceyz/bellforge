// P2-5 LINEAGE v2 — Step 6b: the GRANDPARENT prefix composed with the full split-child leaf, depth-2 lineage. scriptsim with a
// byte-exact sighash + REAL grandparent CHAINS: txGP (a 2-input MINT or a mono-TRANSFER) → txP (a split spending txGP.out0) →
// the current "spend child j → M children" tx. The prefix proves hash256(txGP)‖00 == txP.vin0_outpoint ∧ txGP.out0==ownSPK ∧
// token_id==G (closing mint-from-nothing: txP must have spent a real covenant note). Then splitFullLineageOps runs verbatim.
// Run: node --test native/p1e3_split_grandparent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { splitFullLineageGrandparentOps, genesisGrandparent, transferGrandparent } from './p1e3SplitGrandparent.mjs';
import { HDR_G, genMid, LOCKTIME0 } from './p1e3Const.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const N = 8;
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 100000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);

const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c);
const owner_in = H160(P);

// txP: a degree-Mp split that SPENDS the grandparent's vout0 note (txP.vin0 = gpPointer = committedTxidGP); child j is the note
// the current tx spends (amount=amountIn, owner=owner_in, value=jValueSats). Returns the kernel-witness `parent` + metadata.
function buildTxP(Mp, j, amountIn, jValueSats, changeVal, gpPointer) {
  const children = Array.from({ length: Mp }, (_, k) => ({
    value: k === j ? jValueSats : 50000 + 1000 * k,
    amount: k === j ? amountIn : BigInt(7_000_000 * (k + 1)),
    owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k),
  }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(gpPointer, 0, 0xffffffff);                        // txP.vin0 = the grandparent's vout0 note
  for (const c of children) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, changeVal);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), jValueSats,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal, outputs: children.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) } };
}

// run the composed (prefix + full leaf) op array through scriptsim against the real spend-child-j sighash, with `gpPieces` appended.
function trySpend({ Mp, j, M, txp, outs, changeValue, gpPieces, amountInOverride }) {
  const amountIn = amountInOverride !== undefined ? BigInt(amountInOverride) : outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageWitness({
    parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs, amountIn, N,
  });
  return runScript(splitFullLineageGrandparentOps(Mp, j, M, N, consts), [...w, ...gpPieces], sighash);
}
const rejects = (args) => { try { return !trySpend(args).ok; } catch { return true; } };

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n }]; // Σ=14M

test('lineage-v2 + GRANDPARENT GREEN (genesis chain): mint → split(txP) → spend child j; hash256(txGP_mint)‖00 == txP.vin0', () => {
  for (const j of [0, 1]) {
    const gp = genesisGrandparent({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
    const txp = buildTxP(2, j, 14_000_000n, 100000, 9000, hash256(gp.txGP));
    assert.ok(trySpend({ Mp: 2, j, M: 2, txp, outs: curOuts, changeValue: 15000, gpPieces: gp.pieces }).ok, `genesis-grandparent child ${j}`);
  }
});

test('lineage-v2 + GRANDPARENT GREEN (transfer chain): transfer → split(txP) → spend child j; hash256(txGP_transfer)‖00 == txP.vin0', () => {
  for (const j of [0, 1]) {
    const tailGP = Buffer.concat([u64(7000n), B(0x22), p2tr(0x66), Buffer.from([0, 0, 0, 0])]); // changeOut ‖ locktime
    const gp = transferGrandparent({ tokenId: G, ownSPK, gpVin0Outpoint: Buffer.alloc(36, 0x43), valGP: 90000n, ownerGP: Buffer.alloc(20, 0x33), amtGP: 21_000_000n, tailGP });
    const txp = buildTxP(2, j, 14_000_000n, 100000, 9000, hash256(gp.txGP));
    assert.ok(trySpend({ Mp: 2, j, M: 2, txp, outs: curOuts, changeValue: 15000, gpPieces: gp.pieces }).ok, `transfer-grandparent child ${j}`);
  }
});

test('lineage-v2 + GRANDPARENT leaf size (M\'=2, M=2..4) reported', () => {
  for (const M of [2, 3, 4]) {
    const leaf = bells.script.compile(splitFullLineageGrandparentOps(2, 0, M, N, consts));
    console.log(`  lineage-v2 + grandparent leaf M'=2 j=0 M=${M}: ${leaf.length}B`);
    assert.ok(leaf.length > 0);
  }
});

test('lineage-v2 + GRANDPARENT RED mint-from-nothing: txP.vin0 points at a tx whose out0 is NOT ownSPK', () => {
  // The attack: author an arbitrary tx paying the ATTACKER at vout0 (not a covenant note), point txP.vin0 at it, then try to
  // spend. The covenant rebuilds the grandparent FORCING out0==ownSPK -> hash256(honest-rebuild) != hash256(authoredFake) ->
  // the grandparent EQUALVERIFY (hash256(txGP)‖00 == txP.vin0_outpoint) fails. (= the N9 forged-genesis closure, for the split.)
  const attacker = p2tr(0xde);
  const realGp = genesisGrandparent({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
  const authoredFake = (() => { const t = new bells.Transaction(); t.version = 2; t.addInput(Buffer.alloc(32, 0x01), 0, 0xffffffff); t.addOutput(attacker, Number(VALUE_0)); return t.toBuffer(); })();
  const txp = buildTxP(2, 0, 14_000_000n, 100000, 9000, hash256(authoredFake)); // txP spent the fake (non-covenant) tx
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, txp, outs: curOuts, changeValue: 15000, gpPieces: realGp.pieces }), 'mint-from-nothing (txP.vin0 not a covenant note) rejects');
});

test('lineage-v2 + GRANDPARENT RED cross-token: a grandparent mint of a DIFFERENT token_id rejects', () => {
  // build a real mint of token G' != G; the covenant bakes G in genMid/stateOut0 -> its rebuild != the G' txGP -> reject.
  const Gp = Buffer.alloc(36, 0xcd);
  const otherStateOut0 = Buffer.concat([Buffer.alloc(8, 0), B(0x22, 0x6a, 0x20), S(encodeState({ tokenId: Gp, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const tokenNote0 = Buffer.concat([u64(VALUE_0), B(0x22), ownSPK]);
  // a real txGP for token G' (uses genMid(G') + stateOut0(G')) — but the leaf is built for token G.
  const changeOutGp = Buffer.concat([u64(5000n), B(0x22), p2tr(0x88)]);
  const txGPother = Buffer.concat([HDR_G, Buffer.alloc(36, 0x42), genMid(Gp), tokenNote0, otherStateOut0, feeOut, changeOutGp, Buffer.from(LOCKTIME0)]);
  const txp = buildTxP(2, 0, 14_000_000n, 100000, 9000, hash256(txGPother));
  const pieces = [p2tr(0x88), u64(5000n), Buffer.alloc(36, 0x42), B(0x01)]; // honest-shaped genesis pieces
  assert.ok(rejects({ Mp: 2, j: 0, M: 2, txp, outs: curOuts, changeValue: 15000, gpPieces: pieces }), 'cross-token grandparent rejects');
});
