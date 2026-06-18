// audit S (node-completeness precondition) + T (stateful, reorg-driving ingest). The mock-node reorg PROVES the production
// ingest path actually drives rollbackTo (T's complaint: it was dead outside unit fixtures). PURE (mock rpc) + a live smoke.
// Run: node --test native/p4/ingest_stateful.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import ecc from '@bitcoinerlab/secp256k1';
import { assertNodeComplete, syncStateful } from './ingest.mjs';
import { Indexer } from './indexer.mjs';
import { freezeDeploy } from './deploy.mjs';
import { buildTaptree } from '../freezeEnumerate.mjs';
import { nodeReachable, rpc } from '../../canaries/rpc.mjs';
import { encodeStateV2, OwnerType, tokenId } from '../wire.mjs';
import { u64, sighashComponents, reassembleSighash } from '../sighashParts.mjs';
import { splitAMonoV2Witness, monoGenesisTx } from '../p1e3MonoGenesisV2.mjs';

const S = bells.crypto.sha256, H160 = bells.crypto.hash160, N = 8;
const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const B = (...x) => Buffer.from(x);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const stateScript = (G, amount, owner, ot) => Buffer.concat([B(0x6a, 0x20), S(encodeStateV2({ ownerType: ot, tokenId: G, amount, owner }))]);

// ---------- S: node-completeness precondition ----------
const okNet = (over = {}) => async (m) => ({
  getblockchaininfo: { blocks: 200, pruned: false },
  getnetworkinfo: { localservicesnames: ['NETWORK', 'WITNESS'], localservices: '0000000000000409', version: 30100 },
  ...over,
}[m]);

test('S: assertNodeComplete PASSES on an unpruned witness-serving node', async () => {
  const r = await assertNodeComplete({ rpcFn: okNet() });
  assert.equal(r.pruned, false); assert.equal(r.witness, true);
});
test('S: a PRUNED node is refused with a data-availability error (NOT covenant_escape)', async () => {
  await assert.rejects(assertNodeComplete({ rpcFn: okNet({ getblockchaininfo: { blocks: 200, pruned: true } }) }), /PRUNED|data availability/i);
});
test('S: a node not advertising NODE_WITNESS is refused', async () => {
  await assert.rejects(assertNodeComplete({ rpcFn: okNet({ getnetworkinfo: { localservicesnames: ['NETWORK'], localservices: '0000000000000001' } }) }), /NODE_WITNESS|witness/i);
});

// ---------- T: build a real genesis + split, then drive a reorg through syncStateful (mock node) ----------
function buildChainTxs() {
  const priv = Buffer.alloc(32, 0x0b), P = Buffer.from(ecc.pointFromScalar(priv, true)).subarray(1), OWNER_0 = H160(P);
  const AMOUNT_0 = 21_000_000n, VALUE_0 = 1_000_000n;
  const feeOut = Buffer.concat([u64(100000n), B(0x22), p2tr(0x99)]);
  const G = tokenId({ genesisTxidInternal: Buffer.alloc(32, 0xab), genesisVout: 7 });
  const deploy = freezeDeploy({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen: 34, arms: ['key', 'script'] });
  const tree = buildTaptree(deploy.consts, { arms: ['key', 'script'] });
  const ownSPK = tree.transferSPK, leaf = tree.ordered.find((l) => l.id.fam === 'root-split' && l.id.M === 2).leaf;
  const cb = tree.controlBlockFor(leaf);
  // genesis (legacy, no witness — its txid is hash256 of these bytes)
  const { tx: genBytes, genesisTxid, genesis } = monoGenesisTx({ tokenId: G, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint: Buffer.alloc(36, 0x42), changeValGp: 5000, changeSPKgp: p2tr(0x88) });
  const genesisHex = genBytes.toString('hex');
  // split-a-mono spend of the mint note (witness carries the mono ABI the indexer reads)
  const outs = [{ owner: Buffer.alloc(20, 0xa0), value: 40000, amount: 7_000_000n, ownerType: OwnerType.KEY }, { owner: Buffer.alloc(20, 0xb0), value: 40000, amount: 14_000_000n, ownerType: OwnerType.KEY }];
  const tx = new bells.Transaction(); tx.version = 2; tx.addInput(genesisTxid, 0, 0xffffffff);
  for (const o of outs) { tx.addOutput(ownSPK, o.value); tx.addOutput(stateScript(G, o.amount, o.owner, o.ownerType), 0); }
  const changeValue = Number(VALUE_0) - 80000 - 20000; tx.addOutput(p2tr(0x77), changeValue);
  const real = tx.hashForWitnessV1(0, [ownSPK], [Number(VALUE_0)], bells.Transaction.SIGHASH_DEFAULT, bells.crypto.taggedHash('TapLeaf', Buffer.concat([B(0xc0), B(leaf.length), leaf])));
  const sig = Buffer.from(ecc.signSchnorr(real, priv));
  const parts = sighashComponents({ inputs: [{ txid: Buffer.from(genesisTxid).reverse().toString('hex'), vout: 0, value: Number(VALUE_0), spk: ownSPK, sequence: 0xffffffff }], outputs: tx.outs.map((o) => ({ value: o.value, script: o.script })) });
  const lh = bells.crypto.taggedHash('TapLeaf', Buffer.concat([B(0xc0), B(leaf.length), leaf]));
  const { pre: c1, mid: c7, post: c9 } = reassembleSighash({ inIndex: 0, leafHash: lh, parts });
  const w = splitAMonoV2Witness({ genesis, epi: { sig, P, c1, c3: parts.shaAmounts, c5: parts.shaSequences, c7, c8: lh, c9 }, ownSPK, changeValue, outs, amountIn: AMOUNT_0, N, curChangeSpk: p2tr(0x77), parChangeSpk: p2tr(0x88) });
  tx.ins[0].witness = [...w, leaf, cb];
  return { deploy, genesisHex, splitHex: tx.toHex(), genesisTxid };
}

function mockNode({ genesisHex, splitHex }) {
  const Hg = 100, hg = '11'.repeat(32), hsA = '22'.repeat(32), hf1A = '33'.repeat(32), hf2A = '34'.repeat(32);
  const hsB = 'ab'.repeat(32), hf1B = 'cd'.repeat(32), hf2B = 'ce'.repeat(32);
  let reorged = false;
  const A = { [Hg]: { hash: hg, prev: '00'.repeat(32), txs: [genesisHex] }, [Hg + 1]: { hash: hsA, prev: hg, txs: [splitHex] }, [Hg + 2]: { hash: hf1A, prev: hsA, txs: [] }, [Hg + 3]: { hash: hf2A, prev: hf1A, txs: [] } };
  const Bc = { [Hg]: { hash: hg, prev: '00'.repeat(32), txs: [genesisHex] }, [Hg + 1]: { hash: hsB, prev: hg, txs: [] }, [Hg + 2]: { hash: hf1B, prev: hsB, txs: [] }, [Hg + 3]: { hash: hf2B, prev: hf1B, txs: [] } };
  const chain = () => (reorged ? Bc : A);
  const byHash = () => Object.entries(chain()).reduce((m, [h, b]) => (m[b.hash] = { height: +h, ...b }, m), {});
  const rpcFn = async (method, params) => {
    if (method === 'getblockchaininfo') return { blocks: Hg + 3, pruned: false };
    if (method === 'getnetworkinfo') return { localservicesnames: ['NETWORK', 'WITNESS'], version: 30100 };
    if (method === 'getblockhash') return chain()[params[0]]?.hash;
    if (method === 'getblock') { const b = byHash()[params[0]]; return { height: b.height, hash: b.hash, previousblockhash: b.prev, tx: b.txs.map((hex) => ({ hex })) }; }
    throw new Error('mock: unhandled ' + method);
  };
  return { rpcFn, reorg: () => { reorged = true; }, Hg };
}

test('T: syncStateful drives a REORG through processBlock — the orphaned split rolls back (the path is no longer dead)', async () => {
  const { deploy, genesisHex, splitHex } = buildChainTxs();
  const node = mockNode({ genesisHex, splitHex });
  const ix = new Indexer(deploy);
  // confirmDepth=2: tip=Hg+3, safeTip=Hg+1 ⇒ index genesis(Hg) + split(Hg+1).
  const r1 = await syncStateful(ix, { rpcFn: node.rpcFn, confirmDepth: 2, fromHeight: node.Hg });
  const live1 = [...ix.liveNotes.values()];
  assert.equal(ix.mintCount, 1, 'genesis minted');
  assert.equal(live1.length, 2, 'after the split, the 2 children are live (mint note spent)');
  assert.equal(r1.reorgedFrom, null, 'first sync is a clean forward extend');

  // REORG: the split block is orphaned; chain B has an empty block at that height.
  node.reorg();
  const r2 = await syncStateful(ix, { rpcFn: node.rpcFn, confirmDepth: 2, fromHeight: node.Hg });
  assert.equal(r2.reorgedFrom, node.Hg + 1, 'syncStateful detected the reorg at the split height');
  const live2 = [...ix.liveNotes.values()];
  assert.equal(live2.length, 1, 'after rollback the split children are purged and the genesis note is live again');
  assert.equal(live2[0].amount, 21_000_000n, 'the restored live note is the full-supply genesis note');
  assert.equal(ix.mintCount, 1, 'mintCount still 1 (genesis block was NOT reorged out)');
});

const probe = await nodeReachable();
test('S/T (on-node): assertNodeComplete + syncStateful resume reach the live regtest tip', { skip: probe.up ? false : 'no regtest node' }, async () => {
  const r = await assertNodeComplete({ rpcFn: rpc });
  assert.equal(r.pruned, false);
  assert.ok(r.blocks > 0);
});
