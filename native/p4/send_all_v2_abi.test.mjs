// P4 — the 1→1 SEND-ALL v2 reader (sendAllCandidateV2) + the 2-input SCRIPT 1→1 shape (isScriptMonoTransferShape) + the v2 deploy
// descriptor (buildDeployV2 mints v2-66B). sendAllCandidateV2 reads owner@w[Wk+10]+owner_type@w[Wk+12] for BOTH the mono-genesis
// send-all (Wk=4), the split-child send-all (Wk=3+4·M'), and the SCRIPT arm (4 controller fields ABOVE don't shift the read). The v1
// fixed idx-10 read would MIS-read every v2 send-all. Run: node --test native/p4/send_all_v2_abi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { encodeStateV2, OwnerType } from '../wire.mjs';
import { u64 } from '../sighashParts.mjs';
import { transferSendAllV2Witness, transferSendAllV2ScriptWitness } from '../p1e3TransferV2.mjs';
import { transferAMonoV2Witness } from '../p1e3MonoGenesisV2.mjs';
import { splitParentV2Witness } from '../p1e3SplitLineageV2.mjs';
import { encodeAmount as encAmt } from '../wire.mjs';
import { sendAllCandidateV2, verifyOwnerCandidateV2, stateOutHash32 } from './predicates.mjs';
import { isScriptMonoTransferShape } from './scriptArmPredicates.mjs';
import { buildDeployV2, selfValidateAtGenesis } from './deploy.mjs';
import { monoGenesisTx } from '../p1e3MonoGenesisV2.mjs';

const S = bells.crypto.sha256, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const epi = { sig: Buffer.alloc(64, 9), P: Buffer.alloc(32, 8), c1: Buffer.alloc(9), c3: Buffer.alloc(32), c5: Buffer.alloc(32), c7: Buffer.alloc(5), c8: Buffer.alloc(32), c9: Buffer.alloc(5) };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

// build a tx carrying a witness on vin0 (+ leaf/controlBlock at the top, which the reader ignores), to read w[Wk+10]/w[Wk+12].
function txWithWitness(w, nIns = 1) {
  const tx = new bells.Transaction(); tx.version = 2;
  for (let i = 0; i < nIns; i++) tx.addInput(Buffer.alloc(32, 0x42 + i), 0, 0xffffffff);
  tx.ins[0].witness = [...w, Buffer.alloc(40), Buffer.alloc(33)];
  return tx;
}

test('sendAllCandidateV2: split-child send-all (Wk=3+4·M\') reads owner + owner_type', () => {
  for (const Mp of [2, 3, 4]) {
    const Wk = 3 + 4 * Mp;
    const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
      outputs: Array.from({ length: Mp }, (_, k) => ({ value: 100000 + k, amountSer: encAmt(BigInt(3_000_000 * (k + 1))), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
    const out = { owner: Buffer.alloc(20, 0xa5), value: 250000, ownerType: OwnerType.SCRIPT };  // a key→script deposit
    const w = transferSendAllV2Witness({ parent, epi, ownSPK, changeValue: 15000, out, amountIn: 21_000_000n });
    const tx = txWithWitness(w);
    const cand = sendAllCandidateV2(tx, Wk);
    assert.ok(cand && cand.owner.equals(out.owner) && cand.ownerType === OwnerType.SCRIPT, `Mp=${Mp} reads owner/owner_type at Wk=${Wk}`);
  }
});

test('sendAllCandidateV2: mono-genesis send-all (Wk=4) reads owner + owner_type (send the whole mint note)', () => {
  const genesis = { genesisTxid: Buffer.alloc(32, 1), mintOutpoint: Buffer.alloc(36, 2), changeValGp: 5000, changeSPKgp: p2tr(0x88) };
  const out = { owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.KEY };
  const w = transferAMonoV2Witness({ genesis, epi, ownSPK, changeValue: 15000, out, amountIn: 21_000_000n });
  const tx = txWithWitness(w);
  const cand = sendAllCandidateV2(tx, 4);
  assert.ok(cand && cand.owner.equals(out.owner) && cand.ownerType === OwnerType.KEY, 'Wk=4 reads correctly');
  // the v1 fixed idx-10 read would land on the kernel/epilogue, NOT the owner.
  assert.ok(!Buffer.isBuffer(w[10]) || !w[10].equals(out.owner), 'v1 idx-10 is NOT the v2 owner (the WRONG read the migration deletes)');
});

test('sendAllCandidateV2: SCRIPT arm (4 controller fields ABOVE) does not shift the bottom-relative read', () => {
  const Mp = 2, Wk = 3 + 4 * Mp;
  const parent = { committedTxidP: Buffer.alloc(32, 1), vin0Outpoint: Buffer.alloc(36, 2), changeVal: 5000,
    outputs: Array.from({ length: Mp }, (_, k) => ({ value: 100000 + k, amountSer: encAmt(BigInt(3_000_000 * (k + 1))), owner: Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY })) };
  const out = { owner: Buffer.alloc(20, 0xcc), value: 250000, ownerType: OwnerType.KEY };       // a script→key WITHDRAW
  const w = transferSendAllV2ScriptWitness({ parent, epi, ownSPK, changeValue: 15000, out, amountIn: 21_000_000n,
    script: { outpoint1: Buffer.concat([Buffer.alloc(32, 0x99), u32le(0)]), controllerSPK: p2tr(0x33), poolId: Buffer.alloc(32, 0x55), stateId: Buffer.alloc(32, 0x66) } });
  const tx = txWithWitness(w, 2);
  const cand = sendAllCandidateV2(tx, Wk);
  assert.ok(cand && cand.owner.equals(out.owner) && cand.ownerType === OwnerType.KEY, 'SCRIPT 1→1 read unshifted');
});

test('sendAllCandidateV2: fail-closed on a truncated witness / out-of-range owner_type (→ caller HALTs, never crashes)', () => {
  const genesis = { genesisTxid: Buffer.alloc(32, 1), mintOutpoint: Buffer.alloc(36, 2), changeValGp: 5000, changeSPKgp: p2tr(0x88) };
  const out = { owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.KEY };
  const w = transferAMonoV2Witness({ genesis, epi, ownSPK, changeValue: 15000, out, amountIn: 21_000_000n });
  const truncated = txWithWitness(w.slice(0, 4 + 12));                                            // drops owner_type@Wk+12
  assert.equal(sendAllCandidateV2(truncated, 4), null, 'a short witness returns null (fail-closed)');
  const badType = txWithWitness([...w]); badType.ins[0].witness[4 + 12] = B(0x05);                // owner_type=5 ∉ {0,1,2}
  assert.equal(sendAllCandidateV2(badType, 4), null, 'an out-of-range owner_type returns null');
});

// the indexer's full 1→1 v2 BIND: read the candidate (owner, owner_type) at w[Wk+10]/w[Wk+12], then verifyOwnerCandidateV2 against the
// on-chain out1 stateOut hash. This is exactly the indexer.mjs [4b] path (sendAllCandidateV2 + verifyOwnerCandidateV2(out1, ...)).
const stateScript = (amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
test('sendAllCandidateV2 + verifyOwnerCandidateV2: the read candidate BINDs to out1 (key→script deposit); a tampered owner_type/owner fails the BIND', () => {
  const Wk = 4, amount = 21_000_000n;
  const out = { owner: Buffer.alloc(20, 0xbe), value: 300000, ownerType: OwnerType.SCRIPT };       // a key→script deposit (output type FREE)
  const genesis = { genesisTxid: Buffer.alloc(32, 1), mintOutpoint: Buffer.alloc(36, 2), changeValGp: 5000, changeSPKgp: p2tr(0x88) };
  const tx = new bells.Transaction(); tx.version = 2; tx.addInput(Buffer.alloc(32, 0x42), 0, 0xffffffff);
  tx.addOutput(ownSPK, out.value); tx.addOutput(stateScript(amount, out.owner, out.ownerType), 0); tx.addOutput(changeSPK, 15000);
  tx.ins[0].witness = [...transferAMonoV2Witness({ genesis, epi, ownSPK, changeValue: 15000, out, amountIn: amount }), Buffer.alloc(40), Buffer.alloc(33)];
  const cand = sendAllCandidateV2(tx, Wk);
  assert.ok(cand && cand.owner.equals(out.owner) && cand.ownerType === OwnerType.SCRIPT, 'reads owner + owner_type');
  // BIND: the read candidate reproduces the on-chain out1 stateOut hash.
  assert.ok(verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount, cand.ownerType, cand.owner), 'candidate BINDs to out1');
  // RED: a tampered owner_type does NOT reproduce out1 (the on-chain hash committed SCRIPT, not KEY).
  assert.equal(verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount, OwnerType.KEY, cand.owner), false, 'tampered owner_type fails BIND');
  // RED: a tampered owner does NOT reproduce out1.
  assert.equal(verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount, cand.ownerType, Buffer.alloc(20, 0xff)), false, 'tampered owner fails BIND');
  // RED: a wrong BOUND amount (the indexer BINDs amount=spent.amount) fails too.
  assert.equal(verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount + 1n, cand.ownerType, cand.owner), false, 'wrong amount fails BIND');
});

test('isScriptMonoTransferShape: 2-input vout3 covenant→stateOut→change is the SCRIPT 1→1; 1-input is NOT', () => {
  const stateOut = Buffer.concat([B(0x6a, 0x20), Buffer.alloc(32, 7)]);
  const mk = (nIns) => { const tx = new bells.Transaction(); tx.version = 2; for (let i = 0; i < nIns; i++) tx.addInput(Buffer.alloc(32, 0x42 + i), 0, 0xffffffff); tx.addOutput(ownSPK, 40000); tx.addOutput(stateOut, 0); tx.addOutput(changeSPK, 9000); return tx; };
  assert.equal(isScriptMonoTransferShape(mk(2), ownSPK), true, '2-input SCRIPT 1→1 recognized');
  assert.equal(isScriptMonoTransferShape(mk(1), ownSPK), false, '1-input is the KEY 1→1, not this');
  const wrongSpk = mk(2); assert.equal(isScriptMonoTransferShape(wrongSpk, p2tr(0xde)), false, 'wrong covenant SPK rejected');
});

test('buildDeployV2: mints a v2-66B genesis; selfValidateAtGenesis accepts the v2 mint and HALTs a 1-byte-off descriptor', () => {
  const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n, OWNER_0 = Buffer.alloc(20, 0x55);
  const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
  const deploy = buildDeployV2({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, transferSPK: ownSPK });
  assert.equal(deploy.wireVersion, 'v2');
  assert.equal(deploy.stateOut0.length, 43, 'v2 stateOut0 is FRAME(11)+SHA256(32)=43B');
  // build the real v2 mint tx (ownSPK = the covenant address = deploy.transferSPK) and parse it as a bells tx for selfValidate.
  const { tx: txBytes } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp: p2tr(0x88) });
  const mint = bells.Transaction.fromBuffer(txBytes);
  selfValidateAtGenesis(deploy, mint);                                                            // no throw — the v2 mint matches
  const bad = buildDeployV2({ tokenId: G, AMOUNT_0: AMOUNT_0 + 1n, OWNER_0, VALUE_0, feeOut, transferSPK: ownSPK });
  assert.throws(() => selfValidateAtGenesis(bad, mint), /HALT/, 'a 1-token-off v2 descriptor HALTs at genesis');
});
