// P2-0 BRICK (split-a-mono) — the GENESIS-ROOTED v2 leaves. scriptsim with a byte-exact v2 sighash: build the real mint tx →
// spend the MINT note (genesis @ vout0, KEY-owned by OWNER_0, amount AMOUNT_0) → M split-children (Σ==AMOUNT_0), AND → ONE note at
// the full amount (send-all the undivided supply). Proves the mono-genesis kernel (parks the deploy CONSTANTS) composes with the
// REUSED split/1→1 epilogue. RED battery from the design workflow. Run: node --test native/p1e3_split_a_mono_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, encodeAmount, OwnerType } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageV2Ops } from './p1e3SplitFullLineageV2.mjs';
import { transferSendAllV2Ops } from './p1e3TransferV2.mjs';
import {
  monoGenesisReconstructV2Ops, monoGenesisTx,
  splitAMonoV2Ops, splitAMonoV2Witness, transferAMonoV2Ops, transferAMonoV2Witness,
} from './p1e3MonoGenesisV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c);
const OWNER_0 = H160(P);                                    // the mint note is KEY-owned by the genesis owner key
const consts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner, ownerType) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType, tokenId: G, amount, owner }))]);

// the real genesis (mint) tx + the spent mint note's outpoint (genesisTxid ‖ vout0).
const mintOutpoint = Buffer.alloc(36, 0x42), changeSPKgp = p2tr(0x88), changeValGp = 5000;
function buildGenesis(over = {}) {
  return monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeValGp, changeSPKgp, ...over });
}

// SPLIT-a-mono spend: vin0 = the mint note (genesisTxid, vout0), value VALUE_0 → M children. `over` forges REDs.
function trySplit({ M, outs, gen, leafConsts, inputVout = 0, ownSpkWit, sigKey, amountInWit, extraInput }) {
  gen = gen || buildGenesis();
  leafConsts = leafConsts || consts;
  const amountIn = amountInWit ?? outs.reduce((a, o) => a + o.amount, 0n);
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(gen.genesisTxid).reverse().toString('hex');
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: changeValue, script: changeSPK });
  const inputs = [{ txid: txidHex, vout: inputVout, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }];
  if (extraInput) inputs.push({ txid: Buffer.alloc(32, 0xfe).toString('hex'), vout: 0, value: 50000, spk: p2tr(0x44), sequence: 0xffffffff }); // a co-spent funding input @ vin1
  const parts = sighashComponents({ inputs, outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitAMonoV2Witness({ genesis: gen.genesis, epi: { sig: sigKey ?? sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 },
    ownSPK: ownSpkWit ?? ownSPK, changeValue, outs, amountIn, N });
  return runScript(splitAMonoV2Ops(M, N, leafConsts).ops, w, sighash);
}
const rejectsSplit = (a) => { try { return !trySplit(a).ok; } catch { return true; } };

const twoChildren = [{ owner: Buffer.alloc(20, 0xa0), value: 250000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 250000, amount: 14_000_000n, ownerType: OwnerType.KEY }];

test('GREEN split-a-mono M=2: the mint note → 2 split-children, Σ==AMOUNT_0, signed by the genesis owner key', () => {
  assert.ok(trySplit({ M: 2, outs: twoChildren }).ok, 'first split mines');
});

test('GREEN split-a-mono M=3 and M=4: distinct supply partitions of AMOUNT_0', () => {
  const m3 = [{ owner: Buffer.alloc(20, 0xa0), value: 100000, amount: 3_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 100000, amount: 8_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xc0), value: 100000, amount: 10_000_000n, ownerType: OwnerType.KEY }];
  const m4 = [{ owner: Buffer.alloc(20, 0xa0), value: 80000, amount: 1_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 80000, amount: 5_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xc0), value: 80000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xd0), value: 80000, amount: 8_000_000n, ownerType: OwnerType.KEY }];
  assert.ok(trySplit({ M: 3, outs: m3 }).ok, 'M=3');
  assert.ok(trySplit({ M: 4, outs: m4 }).ok, 'M=4');
});

test('GREEN free output owner_type on the FIRST split: key→script pool deposit at genesis (one KEY, one SCRIPT child)', () => {
  const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 250000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 250000, amount: 14_000_000n, ownerType: OwnerType.SCRIPT }];
  assert.ok(trySplit({ M: 2, outs }).ok, 'first split can deposit into a pool');
});

test('GREEN send-all-the-mint-note: the mint note → ONE note at the FULL amount (move the undivided supply, no split)', () => {
  const gen = buildGenesis();
  const leafHash = Buffer.alloc(32, 0x5a), changeValue = 15000;
  const txidHex = Buffer.from(gen.genesisTxid).reverse().toString('hex');
  const out = { owner: Buffer.alloc(20, 0xa0), value: 300000, ownerType: OwnerType.KEY };
  const outputs = [{ value: out.value, script: ownSPK }, { value: 0, script: stateScript(AMOUNT_0, out.owner, out.ownerType) }, { value: changeValue, script: changeSPK }];
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = transferAMonoV2Witness({ genesis: gen.genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue, out, amountIn: AMOUNT_0 });
  assert.ok(runScript(transferAMonoV2Ops(N, consts).ops, w, sighash).ok, 'send-all the mint note');
});

test('GREEN downstream lineage closure: a split-a-mono tx vin0 == genesisTxid‖u32le(0) — children root to the EXISTING genesis grandparent', () => {
  // The genesis grandparent arm proves hash256(genesis_mint)‖VOUT0_LE == txP.vin0. A real split-a-mono tx IS txP; its vin0 is the
  // mint note outpoint = genesisTxid ‖ 0. So no NEW grandparent shape is needed (p1e3_split_grandparent_v2 genesis arm covers it).
  const gen = buildGenesis();
  const vin0 = Buffer.concat([gen.genesisTxid, B(0, 0, 0, 0)]);
  assert.ok(vin0.subarray(0, 32).equals(gen.genesisTxid) && vin0.subarray(32).equals(Buffer.from([0, 0, 0, 0])), 'vin0 = genesisTxid ‖ vout0');
});

test('RED mint-from-root: children summing to != AMOUNT_0 reject (conservation welds to the const AMOUNT_0, no witness amount_in)', () => {
  const inflated = [{ owner: Buffer.alloc(20, 0xa0), value: 250000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 250000, amount: 14_000_001n, ownerType: OwnerType.KEY }]; // Σ = AMOUNT_0+1
  assert.ok(rejectsSplit({ M: 2, outs: inflated }), 'Σ=AMOUNT_0+1 rejects');
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, amountInWit: AMOUNT_0 + 1n }), 'a forged target != AMOUNT_0 rejects at the Step-5 weld');
});

test('RED wrong-vout: a spend claiming the mint note is at vout 2 rejects (c2 = SHA256(genesisTxid‖0) != real shaPrevouts)', () => {
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, inputVout: 2 }), 'wrong input vout rejects');
});

test('RED 2-input replay: co-spending a funding input @ vin1 rejects (KEY c2=SHA256(1 outpoint) != real 2-input shaPrevouts)', () => {
  // SHA256 preimage-resistance forces exactly ONE input: the leaf binds c2 over a single 36B outpoint, the validator feeds CHECKSIG
  // a shaPrevouts over BOTH outpoints, so CSFS+CHECKSIG cannot both pass. The highest-value note (the mint) is the prime co-spend target.
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, extraInput: true }), 'a 2-input split-a-mono rejects at the CSFS bind');
});

test('RED forged-genesis (tampered piece): a mismatched mintOutpoint breaks hash256(genesis)==genesisTxid', () => {
  const gen = buildGenesis();
  gen.genesis = { ...gen.genesis, mintOutpoint: Buffer.alloc(36, 0xee) };   // witness piece != what built genesisTxid
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, gen }), 'tampered mintOutpoint rejects');
});

test('RED forged token_id: a genesis built with G2 cannot spend under a leaf baking G (genMid+stateOut0 bind token_id)', () => {
  const gen2 = buildGenesis({ tokenId: Buffer.alloc(36, 0xcd) });           // genesis hashes under G2
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, gen: gen2 }), 'cross-token genesis rejects under the G leaf');
});

test('RED forged-shape / brick: a leaf with the WRONG feeOut cannot spend the real genesis (consts must be MEASURED)', () => {
  const leafConsts = { ...consts, feeOut: Buffer.concat([u64(2000n), B(0x22), p2tr(0x99)]) }; // fee 2000 != the genesis's 1000
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, leafConsts }), 'wrong feeOut const rejects (the genesis no longer hash-matches)');
});

test('RED wrong owner-auth: a signer whose hash160(P) != OWNER_0 rejects (only the genesis owner does the first split)', () => {
  // (a) a note owned by 0x99 (leaf + genesis both bake OWNER_0=0x99, so the reconstruction hash-matches) cannot be spent by the
  //     harness key P: the key-auth EQUALVERIFY hash160(P)==parked owner_in(0x99) fails.
  const owned99 = Buffer.alloc(20, 0x99);
  const leaf99 = { ...consts, OWNER_0: owned99 };
  const gen99 = buildGenesis({ OWNER_0: owned99 });
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, gen: gen99, leafConsts: leaf99 }), 'a note owned by 0x99 cannot be spent by P (key-auth)');
  // (b) the OWNER_0=H160(P) leaf cannot spend a genesis minted to a DIFFERENT owner: stateOut0 (leaf bakes H160(P)) != the genesis's
  //     (0x99) -> genesisTxid mismatch -> reconstruction EQUALVERIFY rejects.
  const genOther = buildGenesis({ OWNER_0: owned99 });
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, gen: genOther }), 'a genesis minted to a different owner rejects under the OWNER_0=H160(P) leaf');
});

test('RED ownSPK decoupling: a witness ownSPK != the real input scriptPubKey rejects (c4 / genesis splice mismatch)', () => {
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, ownSpkWit: p2tr(0xbe) }), 'wrong witness ownSPK rejects');
});

test('RED Wk-mismatch assert: the mono kernel (W=4) under the split default Wk=3+4Mp throws (offset-corruption guard)', () => {
  const makeKernel = (extraAbove, ownSpkAbs) => monoGenesisReconstructV2Ops({ ...consts, extraAbove, ownSpkAbs });
  assert.throws(() => splitFullLineageV2Ops(2, 0, 2, N, { tokenId: G, changeSPK, makeKernel }), /kernel W=4 != leaf Wk=11/, 'no Wk override -> assert fires');
});

test('RED change-as-note: a leaf whose changeSPK == ownSPK rejects (the ownSPK != changeSPK VERIFY; an unbound token note)', () => {
  const leafConsts = { ...consts, changeSPK: ownSPK };
  assert.ok(rejectsSplit({ M: 2, outs: twoChildren, leafConsts }), 'changeSPK==ownSPK rejects');
});

test('split-a-mono leaf sizes reported', () => {
  for (const M of [2, 3, 4]) console.log(`  split-a-mono M=${M}: ${bells.script.compile(splitAMonoV2Ops(M, N, consts).ops).length}B`);
  console.log(`  send-all-mint-note: ${bells.script.compile(transferAMonoV2Ops(N, consts).ops).length}B`);
  assert.ok(true);
});
