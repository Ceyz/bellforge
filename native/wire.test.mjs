// P0 — wire-format tests: determinism, round-trip, byte-length pinning, range rejection, canonical
// ordering, reproducible state-root. No node needed. Run: node --test wire.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAmount, decodeAmount, TOKEN_AMOUNT_MAX, encodeState, decodeState, stateCommitment,
  opReturnStateScript, tokenId, EventType, encodeEvent, canonicalSort, foldEvent, stateRootOf, ZERO_ROOT,
} from './wire.mjs';

const fill = (len, b) => Buffer.alloc(len, b);

test('amount: 8-byte LE round-trip + range guards (no sign-bit/overflow)', () => {
  for (const v of [0n, 1n, 1000n, 2n ** 31n, 2n ** 53n, TOKEN_AMOUNT_MAX]) {
    const e = encodeAmount(v);
    assert.equal(e.length, 8);
    assert.equal(decodeAmount(e), v);
  }
  assert.throws(() => encodeAmount(-1n), /out of range/);
  assert.throws(() => encodeAmount(TOKEN_AMOUNT_MAX + 1n), /out of range/); // >= 2^63 rejected
  assert.throws(() => decodeAmount(fill(7, 0)), /exactly 8 bytes/);
});

test('state: round-trip + strict byte-length pinning (token_id 36B, state 65B)', () => {
  const st = { tokenId: fill(36, 0xaa), amount: 12345n, owner: fill(20, 0xbb) };
  const enc = encodeState(st);
  assert.equal(enc.length, 65);
  const dec = decodeState(enc);
  assert.ok(dec.tokenId.equals(st.tokenId) && dec.owner.equals(st.owner) && dec.amount === st.amount);
  assert.throws(() => encodeState({ ...st, owner: fill(21, 0) }), /owner must be exactly 20/);
  assert.throws(() => encodeState({ ...st, tokenId: fill(32, 0) }), /token_id must be exactly 36/);
  assert.throws(() => decodeState(fill(64, 0)), /exactly 65/);
});

test('state commitment + OP_RETURN are deterministic (32-byte hash)', () => {
  const st = encodeState({ tokenId: fill(36, 1), amount: 7n, owner: fill(20, 2) });
  const c1 = stateCommitment(st), c2 = stateCommitment(st);
  assert.equal(c1.length, 32);
  assert.ok(c1.equals(c2));
  const spk = opReturnStateScript(st);
  assert.equal(spk[0], 0x6a); // OP_RETURN
});

test('token_id = 36-byte genesis outpoint', () => {
  const tid = tokenId({ genesisTxidInternal: fill(32, 9), genesisVout: 1 });
  assert.equal(tid.length, 36);
});

test('event: pinned encoding + canonical lexicographic ordering is a permutation-invariant total order (H1)', () => {
  const tid = tokenId({ genesisTxidInternal: fill(32, 9), genesisVout: 0 });
  const ev = encodeEvent({ type: EventType.TRANSFER, tokenId: tid, txidInternal: fill(32, 3), vout: 1, amount: 500n, owner: fill(20, 4) });
  assert.equal(ev.length, 1 + 36 + 32 + 4 + 8 + 20); // 101
  assert.throws(() => encodeEvent({ type: 7, tokenId: tid, txidInternal: fill(32, 0), vout: 0, amount: 0n, owner: fill(20, 0) }), /bad event type/);
  // H1 FIX: canonicalSort operates on the 101-byte ENCODED events (in-preimage), sorted by Buffer.compare.
  const a = encodeEvent({ type: EventType.MINT, tokenId: tid, txidInternal: fill(32, 1), vout: 0, amount: 10n, owner: fill(20, 2) });
  const b = encodeEvent({ type: EventType.MINT, tokenId: tid, txidInternal: fill(32, 1), vout: 2, amount: 30n, owner: fill(20, 2) });
  const c = encodeEvent({ type: EventType.TRANSFER, tokenId: tid, txidInternal: fill(32, 1), vout: 1, amount: 20n, owner: fill(20, 2) });
  // two different input permutations must yield a byte-identical sorted sequence (total order, off-preimage-free)
  const s1 = canonicalSort([a, b, c]);
  const s2 = canonicalSort([c, a, b]);
  assert.ok(s1.every((x, i) => x.equals(s2[i])), 'canonicalSort is not permutation-invariant');
  // and it equals the Buffer.compare order
  const expected = [a, b, c].sort(Buffer.compare);
  assert.ok(s1.every((x, i) => x.equals(expected[i])), 'canonicalSort != lexicographic order');
  // ⇒ the state-root over a canonicalised multiset is permutation-invariant
  assert.ok(stateRootOf(canonicalSort([a, b, c])).equals(stateRootOf(canonicalSort([c, b, a]))));
});

test('state-root: deterministic + reproducible (reindex == live), order-sensitive', () => {
  const tid = tokenId({ genesisTxidInternal: fill(32, 9), genesisVout: 0 });
  const mk = (vout, amt) => encodeEvent({ type: EventType.MINT, tokenId: tid, txidInternal: fill(32, 1), vout, amount: amt, owner: fill(20, 2) });
  const evs = [mk(0, 10n), mk(1, 20n), mk(2, 30n)];
  const live = stateRootOf(evs);
  const reindex = stateRootOf(evs);          // a fresh fold from genesis must match
  assert.ok(live.equals(reindex), 'reindex-from-genesis != live state root');
  assert.equal(live.length, 32);
  const reordered = stateRootOf([evs[1], evs[0], evs[2]]);
  assert.ok(!live.equals(reordered), 'state root must be order-sensitive (canonical order matters)');
  // folding is the documented H(prev ‖ H(event)) chain
  assert.ok(stateRootOf([evs[0]]).equals(foldEvent(ZERO_ROOT, evs[0])));
});
