// state v2 (GENESIS-PERMANENT): version + owner_type, 66B. Run: node --test native/wire_v2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStateV2, decodeStateV2, stateCommitmentV2, OwnerType, STATE_VERSION_V2 } from './wire.mjs';

const tokenId = Buffer.alloc(36, 0xab), owner = Buffer.alloc(20, 0xcd);

test('state v2: encode/decode round-trips for every owner_type', () => {
  for (const ownerType of [OwnerType.KEY, OwnerType.SCRIPT, OwnerType.BURN]) {
    const s = encodeStateV2({ ownerType, tokenId, amount: 21_000_000n, owner });
    assert.equal(s.length, 66);
    assert.equal(s[0], STATE_VERSION_V2); assert.equal(s[1], ownerType);
    const d = decodeStateV2(s);
    assert.equal(d.ownerType, ownerType); assert.equal(d.amount, 21_000_000n);
    assert.ok(d.tokenId.equals(tokenId) && d.owner.equals(owner));
  }
});

test('state v2: rejects a bad owner_type, bad version, wrong length, out-of-range amount', () => {
  assert.throws(() => encodeStateV2({ ownerType: 0x03, tokenId, amount: 1n, owner }), /owner_type/);
  assert.throws(() => decodeStateV2(Buffer.concat([Buffer.from([0x01, 0x00]), tokenId, Buffer.alloc(8), owner])), /version/);
  assert.throws(() => decodeStateV2(Buffer.alloc(65)), /66 bytes/);
  assert.throws(() => encodeStateV2({ ownerType: OwnerType.KEY, tokenId, amount: 1n << 63n, owner }), /out of range/);
  assert.equal(stateCommitmentV2(encodeStateV2({ ownerType: 0, tokenId, amount: 0n, owner })).length, 32);
});
