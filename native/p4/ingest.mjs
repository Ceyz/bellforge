// P4 STEP 2 — live confirmed-block ingestion: fetch blocks from Bells Core RPC, parse them to the indexer's block shape,
// and feed the reorg-aware indexer. Only indexes blocks buried >= CONFIRM_DEPTH below the tip (never the unstable tip; the
// signed attestation needs the depth — Bellscoin has NO consensus finality, probed). The recognizer/state-root/reorg LOGIC
// is proven against synthetic chains in the *.test.mjs; this module is the glue to a real node. rpcFn is injectable for tests.
import * as bells from 'belcoinjs-lib';
import { rpc } from '../../canaries/rpc.mjs';
import { Indexer, CONFIRM_DEPTH } from './indexer.mjs';
import { replayInvariant } from './replay.mjs';
import { isGenesisTemplate } from './predicates.mjs';
import { selfValidateAtGenesis } from './deploy.mjs';

// audit S (2026-06-15) — DATA-AVAILABILITY precondition. The note amount(8)+owner(20) exist on-chain ONLY in the SPENDING
// witness (the stateOut is a prunable OP_RETURN(SHA256)). A pruned / witness-stripped data source returns witness-empty txs,
// so a perfectly VALID historical split reads null candidates and the indexer would throw `covenant_escape` — mis-escalating a
// recoverable INFRA fault to a chain-break HALT / full reindex. Refuse such a source UP FRONT, with a distinct error.
export async function assertNodeComplete({ rpcFn = rpc, rpcOpts = {} } = {}) {
  const info = await rpcFn('getblockchaininfo', [], rpcOpts);
  if (info.pruned) throw new Error('ABORT ingest (data availability): node is PRUNED — historical witness (amount/owner) is unavailable; the divisible ledger cannot be reconstructed. Use an unpruned, witness-serving node. (This is NOT a covenant_escape; the chain is fine, the data source is incomplete.)');
  const net = await rpcFn('getnetworkinfo', [], rpcOpts);
  const names = net.localservicesnames || [];
  const bit = net.localservices ? (BigInt('0x' + net.localservices) & 8n) === 8n : false; // NODE_WITNESS = 1<<3
  if (!names.includes('WITNESS') && !names.includes('NODE_WITNESS') && !bit)
    throw new Error('ABORT ingest (data availability): node does not advertise NODE_WITNESS — getblock witness may be stripped; a valid historical split would mis-read as covenant_escape.');
  return { pruned: false, witness: true, blocks: info.blocks };
}

// a confirmed block as the indexer's { height, blockhash, prevhash, txs:[Transaction] } (verbosity 2 = full tx hex).
export async function fetchBlock(height, opts = {}) {
  const { rpcFn = rpc, ...rpcOpts } = opts;
  const hash = await rpcFn('getblockhash', [height], rpcOpts);
  const b = await rpcFn('getblock', [hash, 2], rpcOpts);
  return { height: b.height, blockhash: b.hash, prevhash: b.previousblockhash, txs: b.tx.map((t) => bells.Transaction.fromHex(t.hex)) };
}

// sync from `fromHeight` (the token's genesis block) up to (tip - confirmDepth) on a FRESH indexer. FAIL-CLOSED: genesis at
// fromHeight + descriptor self-validation + the supply invariant, else HALT (never a silent empty/partial ledger). Now also
// asserts node completeness (S) before reading any witness.
export async function sync(deploy, fromHeight, { confirmDepth = CONFIRM_DEPTH, rpcOpts = {}, rpcFn = rpc, onBlock } = {}) {
  await assertNodeComplete({ rpcFn, rpcOpts });
  const info = await rpcFn('getblockchaininfo', [], rpcOpts);
  const safeTip = info.blocks - confirmDepth;
  if (safeTip < fromHeight) throw new Error(`HALT: safeTip ${safeTip} < genesis height ${fromHeight} — genesis not yet buried ${confirmDepth} deep; refusing to serve a pre-genesis ledger`);
  const ix = new Indexer(deploy);
  for (let h = fromHeight; h <= safeTip; h++) {
    const block = await fetchBlock(h, { rpcFn, ...rpcOpts });
    if (h === fromHeight) {
      const genesisTx = block.txs.find((t) => isGenesisTemplate(t, deploy));
      if (!genesisTx) throw new Error(`HALT: no genesis template for this descriptor at fromHeight ${fromHeight} — wrong fromHeight or wrong descriptor`);
      selfValidateAtGenesis(deploy, genesisTx);
    }
    ix.processBlock(block);
    if (onBlock) onBlock(h, ix);
  }
  replayInvariant(ix);
  return { indexer: ix, safeTip };
}

// audit T (2026-06-15) — STATEFUL, reorg-driving ingest. The old sync() rebuilds a fresh Indexer each run and walks linearly
// forward, so processBlock's reorg branch + rollbackTo + retraction NEVER fire in production (they ran only in unit fixtures).
// This RESUMES a PERSISTENT indexer, detects a reorg BELOW its tip by comparing the node's hash at each recorded height to
// the stored one (the highest match = the common ancestor), and re-feeds the new-canonical blocks through processBlock —
// which rolls back the orphaned branch (un-crediting/un-burning) and re-applies. On a no-finality AuxPoW chain this is the
// load-bearing path. Pass `attest`(ix, retraction) to emit a retraction when a previously-attested root is reorged out.
export async function syncStateful(indexer, { rpcFn = rpc, confirmDepth = CONFIRM_DEPTH, rpcOpts = {}, fromHeight, onBlock, onReorg } = {}) {
  await assertNodeComplete({ rpcFn, rpcOpts });
  const info = await rpcFn('getblockchaininfo', [], rpcOpts);
  const safeTip = info.blocks - confirmDepth;
  let start, reorgFrom = null;
  if (!indexer.tip) {
    if (fromHeight === undefined) throw new Error('syncStateful: a fresh indexer requires fromHeight (the genesis block height)');
    start = fromHeight;
  } else {
    start = indexer.tip.height + 1;
    for (let h = indexer.tip.height; indexer.records.some((r) => r.height === h); h--) {
      const rec = indexer.records.find((r) => r.height === h);
      const nodeHash = await rpcFn('getblockhash', [h], rpcOpts);
      if (nodeHash === rec.blockhash) { start = h + 1; break; }    // common ancestor found
      reorgFrom = h; start = h;                                      // this recorded block was reorged out; re-feed from here
    }
    if (reorgFrom !== null && onReorg) onReorg(reorgFrom, indexer);  // a previously-served/attested root above reorgFrom is now stale
  }
  for (let h = start; h <= safeTip; h++) {
    const block = await fetchBlock(h, { rpcFn, ...rpcOpts });
    indexer.processBlock(block);   // forward-extend, OR (block.prevhash != tip) rollbackTo the fork + re-apply (the audited reorg path)
    if (onBlock) onBlock(h, indexer);
  }
  replayInvariant(indexer);
  return { indexer, safeTip, reorgedFrom: reorgFrom };
}
