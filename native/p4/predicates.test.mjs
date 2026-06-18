// P4 STEP-0 GATE — the frozen predicates, esp. genesis-mirror (P4.isGenesisTemplate accepts IFF the N9 covenant's genesis
// arm would accept, BY CONSTRUCTION: both hash256 the SAME reconstructed bytes). No regtest node needed.
// Run: node --test native/p4/predicates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { makeCovenantRaw } from '../../canaries/tap.mjs';
import { u64, u32, varslice } from '../sighashParts.mjs';
import { encodeState, tokenId } from '../wire.mjs';
import { buildP1e3FullScript } from '../p1e3Covenant.mjs';
import { isStateOut, isCovenantOut0, isMonoInputTransferShape, isGenesisTemplate, reconstructGenesisTxBytes,
  internalTxid, creditAmount, verifyOwnerCandidate, deriveStateOut0 } from './predicates.mjs';

const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);
const p2tr = (fill) => Buffer.concat([B(0x51, 0x20), Buffer.alloc(32, fill)]);
const p2wpkh = (fill) => Buffer.concat([B(0x00, 0x14), Buffer.alloc(20, fill)]);
const stateScript = (G, amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);

// build a per-token deploy descriptor + the matching N9 transferSPK
const gTxid = S(B(0x99));
const G = tokenId({ genesisTxidInternal: gTxid, genesisVout: 0 });
const AMOUNT_0 = 21_000_000n, VALUE_0 = 100000n, F = 50000n;
const OWNER_0 = Buffer.alloc(20, 0xab);
const feeSPK = p2wpkh(0xe1), feeOut = Buffer.concat([u64(F), varslice(feeSPK)]);
const CONSTS = { tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34 };
const transferSPK = makeCovenantRaw(buildP1e3FullScript(CONSTS)).output;
const deploy = { G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, transferSPK, stateOut0: deriveStateOut0(CONSTS), changeSpkLen: 34 };

function canonicalMint({ amount = AMOUNT_0, owner = OWNER_0, value0 = VALUE_0, changeSpk = p2tr(0x44), vin1 = [gTxid, 0] } = {}) {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0x11)), 0, 0xffffffff);                 // vin0 = M (free)
  tx.addInput(vin1[0], vin1[1], 0xffffffff);              // vin1 = G
  tx.addOutput(transferSPK, Number(value0));              // out0
  tx.addOutput(stateScript(G, amount, owner), 0);         // out1
  tx.addOutput(feeSPK, Number(F));                        // out2
  tx.addOutput(changeSpk, 12345);                         // out3
  return tx;
}

test('GENESIS-MIRROR: isGenesisTemplate ACCEPTS the canonical mint (== the covenant genesis arm, by reconstruction)', () => {
  const mint = canonicalMint();
  assert.ok(isGenesisTemplate(mint, deploy), 'the honest 2-input template mint must be recognized as genesis');
  // the reconstruction is byte-identical to the real legacy tx (the same check the covenant does)
  const { default: bb } = { default: bells };
  assert.ok(S(S(reconstructGenesisTxBytes(mint, deploy))).equals(internalTxid(mint)), 'reconstruct hash256 == internalTxid');
});

test('GENESIS-MIRROR RED: a 1-input authored parent is NOT genesis (forged-genesis, mirrors the N9 consensus RED)', () => {
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(S(B(0xde)), 0, 0xffffffff);                 // ONE input (not [M,G])
  tx.addOutput(transferSPK, Number(VALUE_0));
  tx.addOutput(stateScript(G, AMOUNT_0, OWNER_0), 0);
  tx.addOutput(feeSPK, Number(F));
  tx.addOutput(p2tr(0x44), 12345);
  assert.equal(isGenesisTemplate(tx, deploy), false, 'a 1-input parent must NOT be genesis');
});

test('GENESIS-MIRROR RED: wrong AMOUNT_0 / OWNER_0 in the mint stateOut -> not genesis', () => {
  assert.equal(isGenesisTemplate(canonicalMint({ amount: 99999999n }), deploy), false, 'wrong supply rejected');
  assert.equal(isGenesisTemplate(canonicalMint({ owner: Buffer.alloc(20, 0xff) }), deploy), false, 'wrong owner rejected');
});

test('GENESIS-MIRROR RED: G not consumed at vin1, or non-34B change -> not genesis', () => {
  assert.equal(isGenesisTemplate(canonicalMint({ vin1: [S(B(0x77)), 3] }), deploy), false, 'G-missing rejected');
  assert.equal(isGenesisTemplate(canonicalMint({ changeSpk: p2wpkh(0x44) }), deploy), false, 'non-34B change rejected (covenant sizePin)');
});

test('isStateOut: only value==0 + 0x6a 0x20 ‖ 32B (43B serialized); decoys rejected', () => {
  assert.ok(isStateOut({ value: 0, script: stateScript(G, AMOUNT_0, OWNER_0) }));
  assert.equal(isStateOut({ value: 1, script: stateScript(G, AMOUNT_0, OWNER_0) }), false, 'non-zero value rejected');
  assert.equal(isStateOut({ value: 0, script: Buffer.concat([B(0x6a, 0x21), Buffer.alloc(33)]) }), false, 'wrong push length rejected');
  assert.equal(isStateOut({ value: 0, script: p2tr(0x11) }), false, 'non-OP_RETURN rejected');
});

test('isCovenantOut0: FULL 34-byte equality (a 0x5120-prefix lookalike fails)', () => {
  assert.ok(isCovenantOut0({ script: transferSPK }, transferSPK));
  assert.equal(isCovenantOut0({ script: p2tr(0xaa) }, transferSPK), false, 'wrong-key P2TR rejected even though same 0x5120 prefix');
});

test('isMonoInputTransferShape: vin==1, vout==3, out0 covenant, out1 stateOut', () => {
  const t = new bells.Transaction(); t.version = 2;
  t.addInput(S(B(0x33)), 0, 0xffffffff);
  t.addOutput(transferSPK, 80000);
  t.addOutput(stateScript(G, AMOUNT_0, Buffer.alloc(20, 0x77)), 0);
  t.addOutput(p2tr(0x33), 9000);
  assert.ok(isMonoInputTransferShape(t, transferSPK));
  const t2 = canonicalMint(); // 2-input -> not a mono transfer shape
  assert.equal(isMonoInputTransferShape(t2, transferSPK), false);
});

test('BIND-not-DECLARE: creditAmount = spent note amount; verifyOwnerCandidate binds owner to the BOUND amount', () => {
  const spent = { amount: AMOUNT_0, owner: OWNER_0 };
  assert.equal(creditAmount(spent), AMOUNT_0, 'credited amount is the SPENT note amount, never a declared value');
  const newOwner = Buffer.alloc(20, 0x77);
  const out1Hash = S(encodeState({ tokenId: G, amount: AMOUNT_0, owner: newOwner }));
  assert.ok(verifyOwnerCandidate(out1Hash, G, creditAmount(spent), newOwner), 'right owner verifies against the bound amount');
  // an INFLATED on-chain commitment (amount != spent.amount) cannot be reproduced from the bound amount -> rejected
  const inflated = S(encodeState({ tokenId: G, amount: AMOUNT_0 + 1n, owner: newOwner }));
  assert.equal(verifyOwnerCandidate(inflated, G, creditAmount(spent), newOwner), false, 'a declared-inflation commitment is unbindable -> reject');
});
