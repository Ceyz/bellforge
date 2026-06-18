// P2-0 BRICK 8 — the SCRIPT-owned arm WITH a grandparent (a controller-owned note with a proven lineage to genesis = fund-safe).
// The leaf-agnostic grandparent prefix is reused (leafWtotal = the SCRIPT leaf's Wtotal). scriptsim with a real 2-input sighash:
// genesis(v2) → split(txP) → controller co-spends a SCRIPT child j. Run: node --test native/p1e3_split_script_grandparent_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageV2ScriptWitness, scriptOwnerDescriptor } from './p1e3SplitFullLineageV2.mjs';
import { splitScriptGenesisGrandparentV2Ops, splitScriptSplitGrandparentV2Ops, genesisGrandparentV2, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';

const S = bells.crypto.sha256, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const sig = Buffer.alloc(64, 0x0c), P = Buffer.alloc(32, 0x0b);

const controllerSPK = p2tr(0x33), poolId = Buffer.alloc(32, 0x55), stateId = Buffer.alloc(32, 0x66);
const SCRIPT_OWNER = scriptOwnerDescriptor(controllerSPK, poolId, stateId);
const ctrlTxidInternal = Buffer.alloc(32, 0x99), ctrlOutpoint = Buffer.concat([ctrlTxidInternal, u32le(0)]);

function buildTxP(Mp, j, amountIn, committedTxidGP, voutInGp) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? amountIn : BigInt(2_000_000 * (k + 1)),
    owner: k === j ? SCRIPT_OWNER : Buffer.alloc(20, 0xc0 + k), ownerType: k === j ? OwnerType.SCRIPT : OwnerType.KEY }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(committedTxidGP, voutInGp, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner, c.ownerType), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) } };
}

const curOuts = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 9_000_000n, ownerType: OwnerType.SCRIPT }];

function spendScript(Mp, j, txp, gpPieces, ops) {
  const amountIn = 14_000_000n, leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const noteTxidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const ctrlTxidHex = Buffer.from(ctrlTxidInternal).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const inputs = [{ txid: noteTxidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }, { txid: ctrlTxidHex, vout: 0, value: 50000, spk: controllerSPK, sequence: 0xffffffff }];
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2ScriptWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK, changeValue, outs: curOuts, amountIn, N, script: { outpoint1: ctrlOutpoint, controllerSPK, poolId, stateId } });
  return runScript(ops, [...w, ...gpPieces], sighash);
}

test('SCRIPT + GENESIS grandparent GREEN: mint(v2) → split → controller co-spends a SCRIPT child j (fund-safe lineage)', () => {
  for (const j of [0, 1]) {
    const gp = genesisGrandparentV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n });
    const txp = buildTxP(2, j, 14_000_000n, hash256(gp.txGP), 0);
    assert.ok(spendScript(2, j, txp, gp.pieces, splitScriptGenesisGrandparentV2Ops(2, j, 2, N, consts)).ok, `SCRIPT genesis-gp j=${j}`);
  }
});

test('SCRIPT + SPLIT grandparent GREEN: split(v2) → split → controller co-spends a SCRIPT child j', () => {
  const Mp_gp = 2, jprime = 1;
  const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: k % 3 }));
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime, kids, changeValGp: 7000 });
  const txp = buildTxP(2, 0, 14_000_000n, hash256(gp.txGP), 2 * jprime);
  assert.ok(spendScript(2, 0, txp, gp.pieces, splitScriptSplitGrandparentV2Ops(2, 0, 2, N, Mp_gp, consts)).ok, 'SCRIPT split-gp');
});
