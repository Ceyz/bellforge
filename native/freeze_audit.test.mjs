// Pre-freeze audit regressions (PURE, no node) — promoted from the 2026-06-15 audit PoCs (docs/AUDIT_BOUND_PREFREEZE.md):
//   E-2        coverageGaps() is a TRUE total-coverage check (catches dropped/extra reachable leaves);
//   E (520B)   the WORST leaf executes with every built element <= 520B at runtime (not just the maxStackElement formula);
//   CWMONO-1   the FROZEN changeWitness=true mono leaves require the 2 CW witness fields (the shipped builder now appends them).
// Run: node --test native/freeze_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeStateV2, OwnerType, encodeAmount } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { enumerateLeaves, coverageGaps, STRUCTURAL_LEAF_COUNT } from './freezeEnumerate.mjs';
import { splitAMonoV2Ops, splitAMonoV2Witness, monoGenesisTx } from './p1e3MonoGenesisV2.mjs';
import { splitFullLineageV2Witness } from './p1e3SplitFullLineageV2.mjs';
import { splitFullLineageSplitGrandparentV2Ops, splitGrandparentSplitV2 } from './p1e3SplitGrandparentV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const CHANGE_PLACEHOLDER = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32)]);
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);
const baseConsts = { tokenId: Buffer.alloc(36, 0xab), changeSPK: p2tr(0x77), changeWitness: true, AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n, feeOut: Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]), changeSpkLen: 34 };

test('E-2: coverageGaps is a TRUE total-coverage check — catches dropped AND extra reachable leaves', () => {
  const arms = ['key', 'script'];
  const full = enumerateLeaves(baseConsts, { arms });
  assert.equal(full.length, STRUCTURAL_LEAF_COUNT(arms), 'TIER-FULL = 404 = structural count');
  assert.deepEqual(coverageGaps(full, { arms }), [], 'the complete set has no gap');
  // drop a SINGLE reachable leaf (404 -> 403) — the old blind check returned []; the fixed check MUST flag it.
  const drop1 = full.filter((l) => !(l.id.fam === 'split' && l.id.Mp === 2 && l.id.j === 0 && l.id.M === 4 && l.id.gp === 'split' && l.id.Mp_gp === 3 && l.id.arm === 'script'));
  const g1 = coverageGaps(drop1, { arms });
  assert.ok(g1.some((s) => s.includes('MISSING')), 'a single dropped reachable leaf is flagged MISSING');
  // drop whole axes the old check was blind to.
  assert.ok(coverageGaps(full.filter((l) => !(l.id.gp === 'split' && l.id.Mp_gp === 4)), { arms }).length > 0, 'dropping all Mp_gp=4 is caught');
  assert.ok(coverageGaps(full.filter((l) => l.id.j !== 1), { arms }).length > 0, 'dropping all j=1 is caught');
  // an EXTRA (out-of-tuple-space) leaf is caught too.
  const extra = [...full, { id: { fam: 'split', Mp: 5, j: 0, M: 2, gp: 'genesis', arm: 'key' }, leaf: full[0].leaf }];
  assert.ok(coverageGaps(extra, { arms }).some((s) => s.includes('UNEXPECTED') || s.includes('COUNT')), 'an extra/out-of-space leaf is caught');
  // TIER-MIN (key-only) = 204, self-consistent.
  assert.deepEqual(coverageGaps(enumerateLeaves(baseConsts, { arms: ['key'] }), { arms: ['key'] }), []);
});

test('E (520B): the WORST leaf (Mp=4,j=3,M=4,gp=split-4) executes with every built element <= 520B at RUNTIME', () => {
  const Mp = 4, j = 3, M = 4, Mp_gp = 4, jprime = 3;
  const G = baseConsts.tokenId, ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
  const consts = { tokenId: G, changeSPK };
  const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);
  const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const kids = Array.from({ length: Mp_gp }, (_, k) => ({ value: 80000 + k, amount: BigInt(20_000_000 * (k + 1)), owner: Buffer.alloc(20, 0xd0 + k), ownerType: k % 3 }));
  const gp = splitGrandparentSplitV2({ tokenId: G, ownSPK, changeSPK, gpVin0Outpoint: Buffer.alloc(36, 0x44), jprime, kids, changeValGp: 7000 });
  assert.equal(gp.txGP.length, 438, 'the worst gp reconstruction preimage is 438B (the global worst element)');
  // txP: a degree-4 split spending gp.out[2j']; child j=3 = the KEY note we spend.
  const txpKids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? 14_000_000n : BigInt(2_000_000 * (k + 1)), owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k), ownerType: OwnerType.KEY }));
  const txp = (() => {
    const tx = new bells.Transaction(); tx.version = 2;
    tx.addInput(hash256(gp.txGP), 2 * jprime, 0xffffffff);
    for (const c of txpKids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(G, c.amount, c.owner, c.ownerType), 0); }
    tx.addOutput(changeSPK, 9000);
    const legacy = tx.toBuffer();
    return { committedTxidP: hash256(legacy), jValueSats: txpKids[j].value, vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000 };
  })();
  const curOuts = [
    { owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 2_000_000n, ownerType: OwnerType.KEY },
    { owner: Buffer.alloc(20, 0xa1), value: 40000, amount: 3_000_000n, ownerType: OwnerType.SCRIPT },
    { owner: Buffer.alloc(20, 0xa2), value: 40000, amount: 4_000_000n, ownerType: OwnerType.KEY },
    { owner: Buffer.alloc(20, 0xa3), value: 40000, amount: 5_000_000n, ownerType: OwnerType.BURN }];  // Σ=14M
  const leafHash = Buffer.alloc(32, 0x5a);
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const outputs = [];
  for (const o of curOuts) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(G, o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: 15000, script: changeSPK });
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const w = splitFullLineageV2Witness({ parent: { committedTxidP: txp.committedTxidP, vin0Outpoint: txp.vin0Outpoint, changeVal: txp.changeVal, outputs: txpKids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner, ownerType: c.ownerType })) },
    epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 }, ownSPK, changeValue: 15000, outs: curOuts.map((c) => ({ owner: c.owner, value: c.value, amount: c.amount, ownerType: c.ownerType })), amountIn: 14_000_000n, N });
  // runScript's guard() THROWS if any built element exceeds 520B; ok=true also proves cleanstack (the offset/depth tracking is correct).
  const r = runScript(splitFullLineageSplitGrandparentV2Ops(Mp, j, M, N, Mp_gp, consts), [...w, ...gp.pieces], sighash);
  assert.equal(r.ok, true, 'the worst leaf executes clean: no >520B element, cleanstack holds');
  // audit P: the worst leaf's peak concurrent stack must clear the consensus MAX_STACK_SIZE=1000 (else PERMANENTLY unspendable).
  assert.ok(r.peakStack > 0 && r.peakStack < 1000, `worst leaf peak stack ${r.peakStack} must be < 1000 (MAX_STACK_SIZE)`);
});

test('P: every frozen leaf is within the BIP-342 sigops budget (and a peak-stack proxy is sane)', () => {
  const arms = ['key', 'script'];
  const leaves = enumerateLeaves(baseConsts, { arms });
  const O = bells.opcodes;
  let maxSig = 0, maxOps = 0;
  for (const l of leaves) {
    const ops = bells.script.decompile(l.leaf) || [];
    const sig = ops.filter((o) => o === O.OP_CHECKSIG || o === O.OP_CHECKSIGVERIFY || o === 0xcc).length; // 0xcc = CSFS
    maxSig = Math.max(maxSig, sig); maxOps = Math.max(maxOps, ops.length);
    // BIP-342 budget: 50*sigops <= 50 + witnessWeight. These leaves carry multi-KB witnesses ⇒ any small sig count clears it;
    // assert the count stays tiny (the CSFS+CHECKSIG binder, ~2) so the budget is never the binding constraint.
    assert.ok(sig <= 4, `leaf ${JSON.stringify(l.id)} has ${sig} sig-checks (>4 unexpected — re-check the sigops budget)`);
  }
  assert.ok(maxSig >= 2, 'sanity: leaves perform the CSFS+CHECKSIG introspection bind');
  console.log(`  P: 404-leaf max sig-checks=${maxSig}, max decompiled op count=${maxOps} (sigops budget trivially met; peak-stack on the worst leaf asserted <1000 above)`);
});

test('CWMONO-1: the FROZEN changeWitness=true root/mono leaf REQUIRES the 2 CW witness fields', () => {
  const G = baseConsts.tokenId, ownSPK = p2tr(0x11), curChangeSpk = p2tr(0x77), parChangeSpk = p2tr(0x88);
  const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n, OWNER_0 = H160(Buffer.alloc(32, 0x0b));
  const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
  const consts = { tokenId: G, changeSPK: CHANGE_PLACEHOLDER, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeWitness: true };
  const gen = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp: p2tr(0x88) });
  const M = 2, leafHash = Buffer.alloc(32, 0x5a), P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c);
  const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 250000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 250000, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(G, o.amount, o.owner, o.ownerType) }); }
  outputs.push({ value: 15000, script: curChangeSpk });
  const parts = sighashComponents({ inputs: [{ txid: Buffer.from(gen.genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash, parts });
  const epi = { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: leafHash, c9 };
  const ops = splitAMonoV2Ops(M, N, consts).ops;
  // WITHOUT the CW fields (the old shipped builder) -> the witness is 2 items short -> the first CW OP_PICK underflows.
  const wShort = splitAMonoV2Witness({ genesis: gen.genesis, epi, ownSPK, changeValue: 15000, outs, amountIn: AMOUNT_0, N });
  assert.throws(() => runScript(ops, wShort, sighash), /out of range|underflow/i, 'a witness missing the 2 CW fields underflows on the frozen leaf');
  // WITH the CW fields (the CWMONO-1 fix) -> spendable.
  const wFull = splitAMonoV2Witness({ genesis: gen.genesis, epi, ownSPK, changeValue: 15000, outs, amountIn: AMOUNT_0, N, curChangeSpk, parChangeSpk });
  assert.equal(runScript(ops, wFull, sighash).ok, true, 'with curChangeSpk+parChangeSpk appended, the frozen mono leaf spends clean');
  // the builder validates the CW fields are 34B.
  assert.throws(() => splitAMonoV2Witness({ genesis: gen.genesis, epi, ownSPK, changeValue: 15000, outs, amountIn: AMOUNT_0, N, curChangeSpk: B(0x51, 0x20), parChangeSpk }), /34B/, 'non-34B CW field rejected by the builder');
});
