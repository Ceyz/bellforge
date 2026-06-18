// On-stack ALL|ACP reconstruction == the real sighash (via scriptsim CSFS). GREEN proves the covenant rebuilds the 0x81 message
// byte-exact on-stack; REDs prove a spoofed inline amount / outputs / outpoint break the binding (CSFS message mismatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { sighashComponentsAllAcp, reassembleSighashAllAcp } from './sighashPartsAllAcp.mjs';
import { allAcpReconOps, allAcpReconWitness } from './allAcpRecon.mjs';
import { u64, u32 } from './sighashParts.mjs';

const h = (s) => Buffer.from(s, 'hex');
const x32 = (b) => h(String(b).repeat(64)).subarray(0, 32);

const covSpk = Buffer.concat([h('5120'), x32(7)]);                 // 34-byte P2TR (the pool covenant SPK)
const covValue = 10000;
const covTxid = x32(3).toString('hex');                           // display order
const seq = 0xffffffff, leafHash = x32(9);
const outputs = [
  { value: 30_000_000, script: Buffer.concat([h('5120'), x32(1)]) },
  { value: 19_990_000, script: Buffer.concat([h('5120'), x32(2)]) },
  { value: 9_000, script: Buffer.concat([h('0014'), h('cc'.repeat(20))]) },
];

function realSighash(value, outs) {
  const { inputData, shaOutputs } = sighashComponentsAllAcp({ input: { txid: covTxid, vout: 0, value, spk: covSpk, sequence: seq }, outputs: outs });
  return { sighash: reassembleSighashAllAcp({ version: 2, locktime: 0, inputData, shaOutputs, leafHash }).sighash, shaOutputs };
}

function witnessFor(value, outs) {
  const { shaOutputs } = realSighash(value, outs);
  return allAcpReconWitness({
    shaOutputs,
    committedTxid: Buffer.from(covTxid, 'hex').reverse(),          // internal byte order (as the sighash uses)
    amount: u64(value), ownSPK: covSpk, sequence: u32(seq),
    leafHash, sig: Buffer.alloc(64, 7), P: Buffer.alloc(32, 9),
  });
}

const { ops } = allAcpReconOps({ vout: 0 });

test('on-stack ALL|ACP recon == real sighash (CSFS binds)', () => {
  const { sighash } = realSighash(covValue, outputs);
  const r = runScript(ops, witnessFor(covValue, outputs), sighash);
  assert.ok(r.main[r.main.length - 1].equals(Buffer.from([1])), 'CSFS must pass — on-stack message == ALL|ACP sighash');
});

test('RED — a spoofed inline amount (witness y != real spent y) breaks the binding', () => {
  const { sighash } = realSighash(covValue, outputs);              // the REAL sighash uses covValue
  const wBad = witnessFor(covValue + 1, outputs);                  // but the witness claims covValue+1
  assert.throws(() => runScript(ops, wBad, sighash), /CSFS message/, 'spoofed inline amount must mismatch the real sighash');
});

test('RED — tampering an output (shaOutputs) breaks the binding', () => {
  const { sighash } = realSighash(covValue, outputs);
  const tampered = [outputs[0], { ...outputs[1], value: outputs[1].value - 1 }, outputs[2]];
  const wBad = witnessFor(covValue, tampered);                     // shaOutputs over a different output set
  assert.throws(() => runScript(ops, wBad, sighash), /CSFS message/, 'a different output set must mismatch');
});

test('RED — wrong field size (ownSPK not 34B) HALTs at the BIND', () => {
  const { sighash } = realSighash(covValue, outputs);
  const w = witnessFor(covValue, outputs);
  w[3] = Buffer.concat([w[3], h('00')]);                           // ownSPK := 35 bytes
  assert.throws(() => runScript(ops, w, sighash), /EQUALVERIFY/, '|ownSPK|!=34 must HALT at the size pin');
});

test('AUTH epilogue — recon + CSFS + the 65-byte CHECKSIG (sig64‖0x81, single-sourced) passes', () => {
  const { sighash } = realSighash(covValue, outputs);
  const authOps = allAcpReconOps({ vout: 0, auth: true }).ops;
  const r = runScript(authOps, witnessFor(covValue, outputs), sighash);
  assert.ok(r.main[r.main.length - 1].equals(Buffer.from([1])), 'the 65-byte CHECKSIG epilogue must pass');
  // the built CHECKSIG sig is the CSFS-verified sig64 CAT 0x81 ⟹ first 64 bytes are provably the bound sig (no decoupling).
});

test('AUTH epilogue RED — a spoofed inline amount still HALTs (CSFS fires before the CHECKSIG)', () => {
  const { sighash } = realSighash(covValue, outputs);
  const authOps = allAcpReconOps({ vout: 0, auth: true }).ops;
  assert.throws(() => runScript(authOps, witnessFor(covValue + 1, outputs), sighash), /CSFS message/, 'spoofed y must HALT at CSFS');
});
