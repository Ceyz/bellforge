// parentBacktraceOldXOps — the depth-2 backtrace that binds OLD-x to the spent pool note's parent. It rebuilds the parent's pool
// stateOut from old-x and checks hash256(prefix ‖ out1(old-x) ‖ suffix) == committedTxid. GREEN: the real old-x binds. RED: a fake
// old-x changes out1 ⟹ the parent hash ≠ committedTxid ⟹ HALT. (The parent's variable ACP inputs sit in the witnessed prefix.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bells from 'belcoinjs-lib';
import { runScript } from './scriptsim.mjs';
import { parentBacktraceOldXOps } from './buyLeaf.mjs';
import { FRAME } from './p1e3Const.mjs';

const S = bells.crypto.sha256, hash256 = bells.crypto.hash256;
const B = (...x) => Buffer.from(x);
const TOKEN_ID = Buffer.alloc(36, 0xab);                  // must match buyLeaf.mjs's placeholder token_id
const _l8 = (v) => { const o = []; let t = BigInt(v); for (let i = 0; i < 8; i++) { o.push(Number(t & 0xffn)); t >>= 8n; } return o; };

const prefix = Buffer.from('0200000001aabbccddeeff00112233445566778899'.repeat(2), 'hex');   // arbitrary parent bytes BEFORE out1
const suffix = Buffer.from('99887766554433221100ffeeddccbbaa'.repeat(2), 'hex');             // ... AFTER out1
const poolOwner = Buffer.alloc(20, 5);

function committedTxidFor(x) {
  const state = Buffer.concat([B(0x02), B(0x01), TOKEN_ID, Buffer.from(_l8(x)), poolOwner]);
  const out1 = Buffer.concat([FRAME, S(state)]);          // FRAME ‖ SHA256(state) = the parent's pool stateOut (43B)
  return hash256(Buffer.concat([prefix, out1, suffix]));  // = the parent txid
}
const { ops } = parentBacktraceOldXOps({ xSerBase: 0, prefixAbs: 8, ownerAbs: 9, suffixAbs: 10, committedTxidAbs: 11, startDepth: 12 });
const wit = (x, committedTxid) => [..._l8(x).map((b) => B(b)), prefix, poolOwner, suffix, committedTxid];

test('parentBacktrace — the real old-x binds to the parent (hash256 matches committedTxid)', () => {
  const x = 600n;
  assert.doesNotThrow(() => runScript(ops, wit(x, committedTxidFor(x))), 'real old-x must bind');
});

test('parentBacktrace RED — a FAKE old-x is rejected (out1 differs ⟹ parent hash ≠ committedTxid)', () => {
  const real = committedTxidFor(600n);                    // committedTxid is for old-x=600
  assert.throws(() => runScript(ops, wit(601n, real)), /EQUALVERIFY/, 'claiming old-x=601 against the 600-parent must HALT');
});
