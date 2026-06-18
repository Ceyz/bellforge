// P2-5 LINEAGE v2 — the FULL (M', j, M) leaf-matrix sweep (adversarial-review hardening, lens 4 [9]). The genesis-permanent
// taptree will contain a lineage-v2 leaf for EVERY (parent degree M', spent position j, current degree M); only a few were
// scriptsim/regtest-exercised. The cleanstack drop-count + every OP_PICK offset is computed from a build-time `depth` counter, so
// an arithmetic slip in ONE (M',j,M) leaf would be a liveness brick (or, with a compensating second error, a bypass). This sweeps
// the WHOLE grid {2,3,4}×{0..M'-1}×{2,3,4} in scriptsim (the depth/offset class needs no crypto — a green sim is sufficient), for
// BOTH the no-grandparent leaf AND the full genesis-grandparent leaf. Run: node --test native/p1e3_split_lineage_grid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { encodeState, encodeAmount } from './wire.mjs';
import { sighashComponents, reassembleSighash, u64 } from './sighashParts.mjs';
import { splitFullLineageOps, splitFullLineageWitness } from './p1e3SplitFullLineage.mjs';
import { splitFullLineageGrandparentOps, genesisGrandparent } from './p1e3SplitGrandparent.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const hash256 = (b) => S(S(b));
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const G = Buffer.alloc(36, 0xab), ownSPK = p2tr(0x11), changeSPK = p2tr(0x77);
const AMOUNT_0 = 9_000_000_000_000_000n, OWNER_0 = Buffer.alloc(20, 0x55), VALUE_0 = 1_000_000n;
const feeOut = Buffer.concat([u64(1000n), B(0x22), p2tr(0x99)]);
const consts = { tokenId: G, changeSPK };
const gconsts = { tokenId: G, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut };
const stateScript = (amount, owner) => Buffer.concat([B(0x6a, 0x20), S(encodeState({ tokenId: G, amount, owner }))]);
const P = Buffer.alloc(32, 0x0b), sig = Buffer.alloc(64, 0x0c), owner_in = H160(P);

// an amount with all 8 limbs nonzero (< 2^63), to exercise the full byte-limb math; split into M children that sum to it.
const AMOUNT_IN = 0x0102030405060708n;
const splitInto = (M) => { const base = AMOUNT_IN / BigInt(M); const out = []; let acc = 0n; for (let k = 0; k < M - 1; k++) { out.push(base); acc += base; } out.push(AMOUNT_IN - acc); return out; };

// a REAL degree-M' split parent txP whose child j has (AMOUNT_IN, owner_in); vin0 = gpPointer (for the grandparent variant).
function buildTxP(Mp, j, gpPointer) {
  const kids = Array.from({ length: Mp }, (_, k) => ({ value: 50000 + 1000 * k, amount: k === j ? AMOUNT_IN : BigInt(1_000_000 * (k + 1)), owner: k === j ? owner_in : Buffer.alloc(20, 0xc0 + k) }));
  const tx = new bells.Transaction(); tx.version = 2;
  tx.addInput(gpPointer, 0, 0xffffffff);
  for (const c of kids) { tx.addOutput(ownSPK, c.value); tx.addOutput(stateScript(c.amount, c.owner), 0); }
  tx.addOutput(changeSPK, 9000);
  const legacy = tx.toBuffer();
  return { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), jValueSats: kids[j].value,
    parent: { committedTxidP: hash256(legacy), vin0Outpoint: legacy.subarray(5, 41), changeVal: 9000, outputs: kids.map((c) => ({ value: c.value, amountSer: encodeAmount(c.amount), owner: c.owner })) } };
}

// run (M',j,M) through scriptsim for the chosen variant; returns the runScript result.
function runCase(Mp, j, M, { grandparent }) {
  const gp = grandparent ? genesisGrandparent({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeSPKgp: p2tr(0x88), changeValueGp: 5000n }) : null;
  const txp = buildTxP(Mp, j, grandparent ? hash256(gp.txGP) : S(B(0x42)));
  const childAmts = splitInto(M);
  const outs = childAmts.map((amount, k) => ({ owner: Buffer.alloc(20, 0xa0 + k), value: 40000, amount }));
  const outputs = [];
  for (const o of outs) { outputs.push({ value: o.value, script: ownSPK }); outputs.push({ value: 0, script: stateScript(o.amount, o.owner) }); }
  const changeValue = 15000; outputs.push({ value: changeValue, script: changeSPK });
  const txidHex = Buffer.from(txp.committedTxidP).reverse().toString('hex');
  const parts = sighashComponents({ inputs: [{ txid: txidHex, vout: 2 * j, value: txp.jValueSats, spk: ownSPK, sequence: 0xffffffff }], outputs });
  const { pre: c1, mid: c7, post: c9, sighash } = reassembleSighash({ inIndex: 0, leafHash: Buffer.alloc(32, 0x5a), parts });
  const w = splitFullLineageWitness({ parent: txp.parent, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: Buffer.alloc(32, 0x5a), c9 }, ownSPK, changeValue, outs, amountIn: AMOUNT_IN, N });
  const ops = grandparent ? splitFullLineageGrandparentOps(Mp, j, M, N, gconsts) : splitFullLineageOps(Mp, j, M, N, consts).ops;
  const witness = grandparent ? [...w, ...gp.pieces] : w;
  return runScript(ops, witness, sighash);
}

for (const grandparent of [false, true]) {
  test(`lineage-v2 ${grandparent ? '+ GRANDPARENT' : '(no grandparent)'} — FULL (M',j,M) grid sweeps GREEN in scriptsim`, () => {
    let n = 0;
    for (let Mp = 2; Mp <= 4; Mp++) for (let j = 0; j < Mp; j++) for (let M = 2; M <= 4; M++) {
      const r = runCase(Mp, j, M, { grandparent });
      assert.ok(r.ok, `(M'=${Mp}, j=${j}, M=${M}) must be GREEN (cleanstack + offsets correct)`);
      n++;
    }
    assert.equal(n, 27, 'swept all 27 (Mp,j,M) combinations');
  });
}
