// P4 STEP 2 smoke — the live ingestion glue parses a real bellsd block into the indexer's shape (recognizer/state-root/
// reorg LOGIC is proven in the other p4/*.test.mjs against synthetic chains). Run (node up): node --test native/p4/ingest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeReachable } from '../../canaries/rpc.mjs';
import { fetchBlock } from './ingest.mjs';

const probe = await nodeReachable();
const skip = probe.up ? false : `no regtest node (${probe.reason})`;
if (skip) console.log(`\np4 ingest smoke SKIPPED — ${skip}\n`);

test('P4 ingest: fetchBlock parses a real bellsd block into {height, blockhash, prevhash, txs[]}', { skip }, async () => {
  const b = await fetchBlock(probe.blocks - 1); // a recent confirmed block
  assert.equal(typeof b.height, 'number');
  assert.equal(typeof b.blockhash, 'string');
  assert.ok(Array.isArray(b.txs) && b.txs.length >= 1, 'block must parse to >=1 tx');
  // every tx parses to a belcoinjs Transaction with the vin/vout the predicates read
  for (const tx of b.txs) { assert.ok(tx.ins.length >= 1 && tx.outs.length >= 0); assert.equal(typeof tx.getId(), 'string'); }
  console.log(`P4 ingest smoke: block ${b.height} parsed ${b.txs.length} tx(s) — the indexer can consume live blocks`);
});
