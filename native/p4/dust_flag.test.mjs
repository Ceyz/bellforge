// audit G (P4 sub-floor flagging) + H (BURN locks tokenOut sats). PURE. Run: node --test native/p4/dust_flag.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Indexer } from './indexer.mjs';
import { buildDeployV2 } from './deploy.mjs';
import { OwnerType, TOKEN_VALUE_MIN } from '../wire.mjs';

const p2tr = (f) => Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32, f)]);
const deploy = buildDeployV2({ tokenId: Buffer.alloc(36, 0xab), AMOUNT_0: 21_000_000n, OWNER_0: Buffer.alloc(20, 0x55), VALUE_0: 1_000_000n, feeOut: Buffer.alloc(43, 0), transferSPK: p2tr(0x11) });
const G = deploy.G;
const fakeTx = (satValue) => ({ outs: [{ value: satValue, script: p2tr(0x11) }] }); // tokenOut @ vout 0

function credit(satValue, ownerType = OwnerType.KEY) {
  const ix = new Indexer(deploy);
  const ctx = { events: [], created: [], burned: 0n };
  ix.creditChildV2({ tokenId: G, amount: 7_000_000n, owner: Buffer.alloc(20, 0xa0), ownerType, provenance: 'split', parentDegree: 2, vout: 0 }, Buffer.alloc(32, 0x01), fakeTx(satValue), 10, ctx);
  return { ix, ctx };
}

test('G: P4 flags a sub-floor live note as stranded; an at-floor note is not; strandedNotes() surfaces it', () => {
  const below = credit(0);
  const k0 = below.ctx.created[0];
  assert.equal(below.ix.liveNotes.get(k0).stranded, true, '0-sat note flagged stranded');
  assert.equal(below.ix.liveNotes.get(k0).satValue, 0);
  assert.equal(below.ix.strandedNotes().length, 1);

  const one = credit(1);
  assert.equal(one.ix.liveNotes.get(one.ctx.created[0]).stranded, true, '1-sat note flagged stranded');

  const at = credit(Number(TOKEN_VALUE_MIN));
  assert.equal(at.ix.liveNotes.get(at.ctx.created[0]).stranded, false, 'at-floor note not stranded');
  assert.equal(at.ix.strandedNotes().length, 0);
  // still counted for conservation (it is a real live note) — stranded is off-chain metadata only.
  assert.equal(below.ix.liveNotes.size, 1);
});

test('H: a BURN child locks its tokenOut sats — burned (not live), so the attached BELLS are unrecoverable', () => {
  const { ix, ctx } = credit(40000, OwnerType.BURN);
  assert.equal(ctx.created.length, 0, 'BURN child is NOT a live (spendable) note');
  assert.equal(ctx.burned, 7_000_000n, 'its token amount is counted as burned');
  assert.equal(ix.liveNotes.size, 0, 'no live key tracks the 40000-sat BURN tokenOut => those BELLS are locked forever');
});
