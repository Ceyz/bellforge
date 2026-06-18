// BUY pool leaf — step-4 CORE: the covenant BUILDS its committed output set on-stack (incl. the SELF-REPLICATED successor pool
// note at the pool's OWN SPK) → shaOutputs → binds it via the ALL|ACP message + the 65-byte epilogue (brick 1). This is the
// "rolling pool" (GATE 15): output[0] = a new pool note at the same poolSPK with the new BELLS value y' ⟹ the pool persists across
// swaps with NO separate controller. The token-amount stateOuts + the invariant/conservation gadgets compose on top (next); here
// the focus is the output CONSTRUCTION + self-replication + the ACP binding. Outputs (simplified, P2TR-only): [0]=pool note'
// (y'‖poolSPK), [1]=trader note (traderVal‖traderSPK), [2]=change. The inline ACP spk == poolSPK (same witness item) ⟹ the spend
// proves it is the pool note, and the successor is at the same SPK. Layout proven node-exact via buy_leaf.test.mjs (vs belcoinjs).
import * as bells from 'belcoinjs-lib';
import { i32, u32, u64, TAPSIGHASH_TAG } from './sighashParts.mjs';
import { poolUpdateVerifyOps, poolUpdateVerifyWitness, sellPoolUpdateVerifyOps, sellPoolUpdateVerifyWitness } from './mulGadget.mjs';
import { FRAME } from './p1e3Const.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);
const S = bells.crypto.sha256;
const TOKEN_ID = Buffer.alloc(36, 0xab);                  // placeholder token_id (a real leaf bakes the genesis outpoint G)

// opts.base = abs offset of this gadget's 12-item witness in a bigger stack; opts.startDepth = the FULL live stack depth (so a
// composing leaf can run the pool-update verification FIRST, then this output-build + ACP-bind, welding y'/y to its fields).
export function buyAcpBindOps({ vout = 0, version = 2, locktime = 0, auth = true, base = 0, startDepth = null } = {}) {
  const A = { yp: base + 0, poolSPK: base + 1, traderVal: base + 2, traderSPK: base + 3, changeVal: base + 4, changeSPK: base + 5, committedTxid: base + 6, amount: base + 7, sequence: base + 8, leafHash: base + 9, sig: base + 10, P: base + 11 };
  const PRE = Buffer.concat([B(0x81), i32(version), u32(locktime)]);
  const VOUT_LE = u32(vout);
  const POST = Buffer.concat([B(0x00), B(0xff, 0xff, 0xff, 0xff)]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  const ops = []; let depth = startDepth ?? 12;
  const DELTA = { [O.OP_CAT]: -1, [O.OP_SIZE]: 1, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_VERIFY]: -1, [O.OP_CHECKSIG]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pinSize = (abs, n) => { pick(abs); e(O.OP_SIZE, enc(n), O.OP_EQUALVERIFY, O.OP_DROP); };
  const out = (valAbs, spkAbs) => { pick(valAbs); e(B(0x22), O.OP_CAT); pick(spkAbs); e(O.OP_CAT); }; // u64(val) ‖ varslice(spk=34B)

  pinSize(A.yp, 8); pinSize(A.poolSPK, 34); pinSize(A.traderVal, 8); pinSize(A.traderSPK, 34);
  pinSize(A.changeVal, 8); pinSize(A.changeSPK, 34); pinSize(A.committedTxid, 32); pinSize(A.amount, 8);
  pinSize(A.sequence, 4); pinSize(A.leafHash, 32);
  pinSize(A.P, 32); pinSize(A.sig, 64);                  // CRITICAL (audit P0): |P|==32 ∧ |sig|==64 — a non-32B pubkey ⟹ CSFS/CHECKSIG pass WITHOUT verifying ⟹ pool drain

  // ----- BUILD shaOutputs = SHA256( out0 ‖ out1 ‖ out2 ), out0 = the SELF-REPLICATED successor pool note (poolSPK) -----
  out(A.yp, A.poolSPK);                                  // out0 = y' ‖ poolSPK   (successor pool note)
  out(A.traderVal, A.traderSPK); e(O.OP_CAT);            // ‖ out1 (trader note)
  out(A.changeVal, A.changeSPK); e(O.OP_CAT);            // ‖ out2 (change)
  e(O.OP_SHA256);                                        // shaOutputs (on top)

  // ----- ACP message = PRE ‖ shaOutputs ‖ 0x02 ‖ inputData ‖ leafHash ‖ post ; inputData uses poolSPK ⟹ self == the pool note -----
  e(PRE, O.OP_SWAP, O.OP_CAT, B(0x02), O.OP_CAT);        // PRE ‖ shaOutputs ‖ spend_type = head
  pick(A.committedTxid); e(VOUT_LE, O.OP_CAT);
  pick(A.amount); e(O.OP_CAT);                           // ‖ amount (the OLD pool value y, inline)
  e(B(0x22), O.OP_CAT); pick(A.poolSPK); e(O.OP_CAT);    // ‖ varslice(poolSPK)  (the spent input's own spk)
  pick(A.sequence); e(O.OP_CAT);                         // ‖ sequence = inputData
  e(O.OP_CAT);                                           // head ‖ inputData
  pick(A.leafHash); e(O.OP_CAT); e(POST, O.OP_CAT);      // ‖ leafHash ‖ post = message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);           // computed = SHA256(PREFIX ‖ message)

  pick(A.sig); e(O.OP_SWAP); pick(A.P);                  // [.., sig, computed, P]
  ops.push(0xcc); depth -= 2;                            // CSFS: computed == real ALL|ACP sighash → [.., 1]
  if (!auth) return { ops, A };
  e(O.OP_VERIFY);                                        // 65-byte CHECKSIG epilogue (single-sourced sig64‖0x81)
  pick(A.sig); e(B(0x81), O.OP_CAT); e(O.OP_SIZE, enc(65), O.OP_EQUALVERIFY); pick(A.P); e(O.OP_CHECKSIG);
  return { ops, A };                                      // A.yp = output[0].value abs, A.amount = inline ACP value abs (for welds)
}

export function buyAcpBindWitness({ yp, poolSPK, traderVal, traderSPK, changeVal, changeSPK, committedTxid, amount, sequence, leafHash, sig, P }) {
  return [yp, poolSPK, traderVal, traderSPK, changeVal, changeSPK, committedTxid, amount, sequence, leafHash, sig, P];
}

// ============================================================================================================================
// buyPoolLeafOps — the COMPLETE BUY pool leaf (the two halves composed): the pool-update VERIFICATION (`poolUpdateVerifyOps`:
// x'·y' ≥ x·y AND x == x' + tokenOut, x/x' cross-welded) THEN the output-construction + ALL|ACP BINDING (`buyAcpBindOps`: the
// self-replicated pool note + the ACP message), with two WELDS single-sourcing the verification's value reserves to the bound tx
// fields: y' (the invariant operand) == output[0].value (the c6-committed NEW pool value), and y == the inline ACP value (the
// bound OLD pool value). So the invariant's BELLS reserves ARE the real on-chain values. REMAINING (flagged): x'/tokenOut into the
// OP_RETURN stateOuts (the $BOUND topology — buyLeaf is P2TR-only here) + `buyParentReconstructOps` to backtrace old-x.
export function buyPoolLeafOps({ na = 4, nb = 8 } = {}) {
  const probe = poolUpdateVerifyOps(na, nb);
  const puvSize = probe.localSize, W = probe.W;
  const buyBase = puvSize, fullDepth = puvSize + 12;
  const puv = poolUpdateVerifyOps(na, nb, { startDepth: fullDepth });
  const buy = buyAcpBindOps({ base: buyBase, startDepth: fullDepth, auth: true });
  const ops = [...puv.ops];
  let depth = fullDepth;                                  // puv is verify-only (net 0) ⟹ depth stays fullDepth
  const pk = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const weldBlob = (serBase, blobAbs) => {                // CAT the 8 LE ser bytes → an 8-byte blob, EQUALVERIFY with the blob field
    pk(serBase); for (let i = 1; i < 8; i++) { pk(serBase + i); ops.push(O.OP_CAT); depth -= 1; }
    pk(blobAbs); ops.push(O.OP_EQUALVERIFY); depth -= 2;
  };
  const invYpSer = 2 * W + 40, invYSer = 2 * W + 16;      // within the puv region (inv @ base 0): ypSer=2W+40, ySer=2W+16
  weldBlob(invYpSer, buy.A.yp);                           // y' (invariant) == output[0].value (the NEW pool BELLS reserve)
  weldBlob(invYSer, buy.A.amount);                        // y  (invariant) == inline ACP value (the OLD pool BELLS reserve)
  ops.push(...buy.ops);                                   // then BUILD outputs + bind via ALL|ACP + the 65B epilogue
  return { ops, fullDepth, puvSize };
}
export function buyPoolLeafWitness({ x, y, xp, yp, tokenOut, poolSPK, traderVal, traderSPK, changeVal, changeSPK, committedTxid, sequence, leafHash, sig, P }) {
  return [
    ...poolUpdateVerifyWitness({ x, y, xp, yp, tokenOut }),                              // verification region (deepest)
    ...buyAcpBindWitness({ yp: u64(yp), poolSPK, traderVal: u64(traderVal), traderSPK,   // binding region
      changeVal: u64(changeVal), changeSPK, committedTxid, amount: u64(y), sequence: u32(sequence), leafHash, sig, P }),
  ];
}

// ============================================================================================================================
// buyPoolLeafFullOps — the COMPLETE BUY leaf with the REAL $BOUND output topology (interleaved note‖stateOut). It single-sources
// EVERY value-bearing operand from the verification region BY CONSTRUCTION (no welds): the 8-byte serializations of y, y', x',
// tokenOut are CAT'd straight from the verification's witness bytes into the c6 outputs (y'→output[0].value, x'→pool stateOut
// amount, tokenOut→trader stateOut amount) and the inline ACP value (y→inline). 5 outputs: out0=pool note' (self-replicated @
// poolSPK), out1=pool stateOut(x'), out2=trader note, out3=trader stateOut(tokenOut), out4=change. stateOut = FRAME ‖ SHA256(0x02 ‖
// owner_type ‖ token_id ‖ amount_ser ‖ owner). The ONLY remaining piece is `buyParentReconstructOps` for old-x (the backtrace).
export function buyPoolLeafFullOps({ na = 4, nb = 8, backtrace = true } = {}) {
  const probe = poolUpdateVerifyOps(na, nb);
  const puvSize = probe.localSize, W = probe.W, Linv = probe.Linv;
  const fullDepth = puvSize + (backtrace ? 14 : 12);     // +2 for the parent prefix/suffix when binding old-x
  const puv = poolUpdateVerifyOps(na, nb, { startDepth: fullDepth });
  const ops = [...puv.ops];
  let depth = fullDepth;
  const DELTA = { [O.OP_CAT]: -1, [O.OP_SIZE]: 1, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_VERIFY]: -1, [O.OP_CHECKSIG]: -1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pinSize = (abs, n) => { pick(abs); e(O.OP_SIZE, enc(n), O.OP_EQUALVERIFY, O.OP_DROP); };
  const catBlob = (serBase) => { pick(serBase); for (let i = 1; i < 8; i++) { pick(serBase + i); e(O.OP_CAT); } };   // 8 ser bytes → 8-byte blob
  const note = (valBlobFn, spkAbs) => { valBlobFn(); e(B(0x22), O.OP_CAT); pick(spkAbs); e(O.OP_CAT); };             // u64(val) ‖ varslice(spk)
  const stateOut = (otByte, amtSerBase, ownerAbs) => {           // FRAME ‖ SHA256(0x02 ‖ owner_type ‖ token_id ‖ amount_ser ‖ owner)
    e(B(0x02), B(otByte), O.OP_CAT, TOKEN_ID, O.OP_CAT);
    catBlob(amtSerBase); e(O.OP_CAT);
    pick(ownerAbs); e(O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT);
  };
  // binding-witness abs (region @ puvSize): poolSPK, poolOwner, traderSPK, traderVal, traderOwner, changeVal, changeSPK, committedTxid, sequence, leafHash, sig, P
  const Bp = puvSize;
  const poolSPK = Bp, poolOwner = Bp + 1, traderSPK = Bp + 2, traderVal = Bp + 3, traderOwner = Bp + 4, changeVal = Bp + 5, changeSPK = Bp + 6, committedTxid = Bp + 7, sequence = Bp + 8, leafHash = Bp + 9, sig = Bp + 10, P = Bp + 11;
  // verification source positions (within the puv region): inv ySer/ypSer, conservation xpSer/toSer
  const ySer = 2 * W + 16, ypSer = 2 * W + 40, xpSer = Linv + 16, toSer = Linv + 32;
  pinSize(poolSPK, 34); pinSize(poolOwner, 20); pinSize(traderSPK, 34); pinSize(traderVal, 8); pinSize(traderOwner, 20);
  pinSize(changeVal, 8); pinSize(changeSPK, 34); pinSize(committedTxid, 32); pinSize(sequence, 4); pinSize(leafHash, 32);
  pinSize(P, 32); pinSize(sig, 64);                      // CRITICAL (audit P0): |P|==32 ∧ |sig|==64 — non-32B pubkey ⟹ CSFS/CHECKSIG pass WITHOUT verifying ⟹ pool drain

  // ----- BIND old-x to the parent (depth-2 backtrace): reconstruct the parent's pool stateOut from x (the verification's old
  //       token reserve, @ the invariant xSer = 2W) + hash256(prefix ‖ out1(x) ‖ suffix) == committedTxid. Verify-only (net 0). -----
  if (backtrace) {
    const bt = parentBacktraceOldXOps({ xSerBase: 2 * W, prefixAbs: Bp + 12, ownerAbs: poolOwner, suffixAbs: Bp + 13, committedTxidAbs: committedTxid, otByte: 0x01, startDepth: fullDepth });
    ops.push(...bt.ops);                                         // depth unchanged (the backtrace is verify-only)
  }

  // ----- BUILD the 5-output c6 preimage, single-sourcing y'/x'/tokenOut from the verification bytes -----
  note(() => catBlob(ypSer), poolSPK);                          // out0 = pool note' (value y', self-SPK)
  stateOut(0x01, xpSer, poolOwner); e(O.OP_CAT);               // ‖ out1 = pool stateOut (SCRIPT, amount x')
  note(() => pick(traderVal), traderSPK); e(O.OP_CAT);        // ‖ out2 = trader token note
  stateOut(0x00, toSer, traderOwner); e(O.OP_CAT);            // ‖ out3 = trader stateOut (KEY, amount tokenOut)
  note(() => pick(changeVal), changeSPK); e(O.OP_CAT);       // ‖ out4 = change
  e(O.OP_SHA256);                                              // shaOutputs

  // ----- ALL|ACP message = PRE ‖ shaOutputs ‖ 0x02 ‖ inputData ‖ leafHash ‖ post ; inline value y from the verification -----
  const PRE = Buffer.concat([B(0x81), i32(2), u32(0)]), POST = Buffer.concat([B(0x00), B(0xff, 0xff, 0xff, 0xff)]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  e(PRE, O.OP_SWAP, O.OP_CAT, B(0x02), O.OP_CAT);              // PRE ‖ shaOutputs ‖ spend_type
  pick(committedTxid); e(u32(0), O.OP_CAT);                    // ‖ outpoint (committedTxid ‖ vout=0)
  catBlob(ySer); e(O.OP_CAT);                                 // ‖ inline value y (single-sourced from the verification)
  e(B(0x22), O.OP_CAT); pick(poolSPK); e(O.OP_CAT);           // ‖ varslice(poolSPK)  (self == the pool note)
  pick(sequence); e(O.OP_CAT); e(O.OP_CAT);                   // ‖ sequence = inputData ; head ‖ inputData
  pick(leafHash); e(O.OP_CAT); e(POST, O.OP_CAT);             // ‖ leafHash ‖ post = message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                // computed
  pick(sig); e(O.OP_SWAP); pick(P); ops.push(0xcc); depth -= 2;   // CSFS
  e(O.OP_VERIFY); pick(sig); e(B(0x81), O.OP_CAT); e(O.OP_SIZE, enc(65), O.OP_EQUALVERIFY); pick(P); e(O.OP_CHECKSIG); // 65B epilogue
  return { ops, fullDepth, puvSize, W, Linv };
}
export function buyPoolLeafFullWitness({ x, y, xp, yp, tokenOut, poolSPK, poolOwner, traderSPK, traderVal, traderOwner, changeVal, changeSPK, committedTxid, sequence, leafHash, sig, P, parentPrefix, parentSuffix }) {
  const w = [
    ...poolUpdateVerifyWitness({ x, y, xp, yp, tokenOut }),
    poolSPK, poolOwner, traderSPK, u64(traderVal), traderOwner, u64(changeVal), changeSPK, committedTxid, u32(sequence), leafHash, sig, P,
  ];
  if (parentPrefix !== undefined) w.push(parentPrefix, parentSuffix);   // the parent tx around out1 (for the old-x backtrace)
  return w;
}
// off-chain helper: the parent's stateOut (out1) for amount `x`, and committedTxid = parent txid (internal order). otByte = the
// note's owner_type (0x01 SCRIPT for a pool note, 0x00 KEY for a trader's token note).
export function buyPoolParent({ x, poolOwner, parentPrefix, parentSuffix, otByte = 0x01 }) {
  const _l8 = (v) => { const o = []; let t = BigInt(v); for (let i = 0; i < 8; i++) { o.push(Number(t & 0xffn)); t >>= 8n; } return Buffer.from(o); };
  const out1 = Buffer.concat([FRAME, S(Buffer.concat([B(0x02), B(otByte), TOKEN_ID, _l8(x), poolOwner]))]);
  return { committedTxid: bells.crypto.hash256(Buffer.concat([parentPrefix, out1, parentSuffix])) };  // = the spent note's parent txid
}

// ============================================================================================================================
// sellPoolLeafCoreOps — the SELL leaf's verification + DUAL backtrace (the SELL-specific cross-input binding). The SELL is a
// COMMITTED 2-input co-spend (vin0 = pool note, vin1 = trader's token note); the conservation x' == x + d needs BOTH x (the pool's
// old token reserve) and d (the trader's deposited amount) bound to their respective PARENTS — neither is in the spend's own
// committed fields. So: `sellPoolUpdateVerifyOps` (invariant + x'=x+d) + `parentBacktraceOldXOps`×2 — one binding x to the pool's
// parent (SCRIPT stateOut), one binding d to the trader-note's parent (KEY stateOut). This is what ACP cannot do (it can't see the
// counterparty input); the committed topology + dual backtrace closes it. (The full DEFAULT 2-input sighash + the BELLS-payout
// outputs reuse the proven merge/split machinery — `p1e3MergeK2V2`; this core proves the verification + the cross-input binding.)
export function sellPoolLeafCoreOps({ na = 4, nb = 8 } = {}) {
  const probe = sellPoolUpdateVerifyOps(na, nb);
  const puvSize = probe.localSize, W = probe.W, Linv = probe.Linv;
  const Bp = puvSize, fullDepth = puvSize + 8;
  const puv = sellPoolUpdateVerifyOps(na, nb, { startDepth: fullDepth });
  const ops = [...puv.ops];
  const poolTxid = Bp, poolOwner = Bp + 1, poolPrefix = Bp + 2, poolSuffix = Bp + 3, traderTxid = Bp + 4, traderOwner = Bp + 5, traderPrefix = Bp + 6, traderSuffix = Bp + 7;
  const xSer = 2 * W, dSer = Linv + 32;                  // x = the invariant's xSer (old pool token) ; d = the conservation's toSer (trader deposit)
  const btPool = parentBacktraceOldXOps({ xSerBase: xSer, prefixAbs: poolPrefix, ownerAbs: poolOwner, suffixAbs: poolSuffix, committedTxidAbs: poolTxid, otByte: 0x01, startDepth: fullDepth });
  const btTrader = parentBacktraceOldXOps({ xSerBase: dSer, prefixAbs: traderPrefix, ownerAbs: traderOwner, suffixAbs: traderSuffix, committedTxidAbs: traderTxid, otByte: 0x00, startDepth: fullDepth });
  ops.push(...btPool.ops, ...btTrader.ops);
  return { ops, fullDepth, puvSize, W, Linv };
}
// sellPoolOutputsBuildOps — build the SELL output set's shaOutputs on-stack and assert it == the bound target. SELL outputs:
// out0=pool note'(y'‖poolSPK self-replicated), out1=pool stateOut(x'=x+d), out2=trader BELLS payout (bellsOut‖traderSPK — the
// trader RECEIVES BELLS, not a token note), out3=change. x' single-sourced (the amount blob CAT'd into the stateOut). The full
// SELL leaf binds this via the DEFAULT 2-input sighash (c2=SHA256(op0‖op1), c4=SHA256(varslice(poolSPK)‖varslice(traderSPK))) —
// the proven merge/SCRIPT-arm pattern; here we prove the SELL output topology builds byte-exact.
export function sellPoolOutputsBuildOps() {
  const A = { yp: 0, poolSPK: 1, xp: 2, poolOwner: 3, bellsOut: 4, traderSPK: 5, changeVal: 6, changeSPK: 7, expected: 8 };
  const ops = []; let depth = 9;
  const DELTA = { [O.OP_CAT]: -1, [O.OP_SIZE]: 1, [O.OP_EQUALVERIFY]: -2, [O.OP_DROP]: -1, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pinSize = (abs, n) => { pick(abs); e(O.OP_SIZE, enc(n), O.OP_EQUALVERIFY, O.OP_DROP); };
  const note = (valAbs, spkAbs) => { pick(valAbs); e(B(0x22), O.OP_CAT); pick(spkAbs); e(O.OP_CAT); };
  pinSize(A.yp, 8); pinSize(A.poolSPK, 34); pinSize(A.xp, 8); pinSize(A.poolOwner, 20); pinSize(A.bellsOut, 8); pinSize(A.traderSPK, 34); pinSize(A.changeVal, 8); pinSize(A.changeSPK, 34);
  note(A.yp, A.poolSPK);                                  // out0 = pool note'
  e(B(0x02), B(0x01), O.OP_CAT, TOKEN_ID, O.OP_CAT); pick(A.xp); e(O.OP_CAT); pick(A.poolOwner); e(O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); e(O.OP_CAT);  // ‖ out1 = pool stateOut(x')
  note(A.bellsOut, A.traderSPK); e(O.OP_CAT);            // ‖ out2 = trader BELLS payout
  note(A.changeVal, A.changeSPK); e(O.OP_CAT);          // ‖ out3 = change
  e(O.OP_SHA256);                                        // shaOutputs
  pick(A.expected); e(O.OP_EQUALVERIFY);                 // == the c6/sha_outputs the DEFAULT 2-input sighash commits
  return { ops };
}
export function sellPoolOutputs({ yp, poolSPK, xp, poolOwner, bellsOut, traderSPK, changeVal, changeSPK }) {
  const _l8 = (v) => { const o = []; let t = BigInt(v); for (let i = 0; i < 8; i++) { o.push(Number(t & 0xffn)); t >>= 8n; } return Buffer.from(o); };
  const stateScript = Buffer.concat([B(0x6a, 0x20), S(Buffer.concat([B(0x02), B(0x01), TOKEN_ID, _l8(xp), poolOwner]))]);
  const out = (val, spk) => Buffer.concat([_l8(val), B(0x22), spk]);
  const stateOut = Buffer.concat([FRAME, S(Buffer.concat([B(0x02), B(0x01), TOKEN_ID, _l8(xp), poolOwner]))]);
  const sha = bells.crypto.sha256(Buffer.concat([out(yp, poolSPK), stateOut, out(bellsOut, traderSPK), out(changeVal, changeSPK)]));
  return { shaOutputs: sha };
}

export function sellPoolLeafCoreWitness({ x, y, xp, yp, d, poolOwner, poolPrefix, poolSuffix, traderOwner, traderPrefix, traderSuffix }) {
  const poolTxid = buyPoolParent({ x, poolOwner, parentPrefix: poolPrefix, parentSuffix: poolSuffix, otByte: 0x01 }).committedTxid;
  const traderTxid = buyPoolParent({ x: d, poolOwner: traderOwner, parentPrefix: traderPrefix, parentSuffix: traderSuffix, otByte: 0x00 }).committedTxid;
  return [
    ...sellPoolUpdateVerifyWitness({ x, y, xp, yp, d }),
    poolTxid, poolOwner, poolPrefix, poolSuffix, traderTxid, traderOwner, traderPrefix, traderSuffix,
  ];
}
// parentBacktraceOldXOps — bind OLD-x (the pool's token reserve BEFORE this swap) to the spent pool note's parent (the prior
// swap). The pool note's amount lives in the parent's pool stateOut (out1); the leaf REBUILDS that stateOut from old-x (single-
// sourced from the verification region) and reconstructs the whole parent as `prefix ‖ out1(old-x) ‖ suffix`, then
// hash256(...) == committedTxid (the parent txid, = the spent note's outpoint hash). The parent's VARIABLE inputs (it was itself
// an ACP swap) sit inside the WITNESSED prefix — so the leaf needn't know them; a fake old-x changes out1 ⟹ the hash ≠
// committedTxid ⟹ reject. This is the depth-2 backtrace that the ACP topology needs. EMBEDDABLE, verify-only.
export function parentBacktraceOldXOps({ xSerBase, prefixAbs, ownerAbs, suffixAbs, committedTxidAbs, otByte = 0x01, startDepth }) {
  const ops = []; let depth = startDepth;
  const DELTA = { [O.OP_CAT]: -1, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_HASH256]: 0, [O.OP_EQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const catBlob = (serBase) => { pick(serBase); for (let i = 1; i < 8; i++) { pick(serBase + i); e(O.OP_CAT); } };
  e(B(0x02), B(otByte), O.OP_CAT, TOKEN_ID, O.OP_CAT);   // 0x02 ‖ owner_type ‖ token_id
  catBlob(xSerBase); e(O.OP_CAT);                        // ‖ old-x_ser (single-sourced from the verification)
  pick(ownerAbs); e(O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT);   // ‖ owner → SHA256 → FRAME‖hash = out1 (the parent pool stateOut)
  pick(prefixAbs); e(O.OP_SWAP, O.OP_CAT);               // prefix ‖ out1
  pick(suffixAbs); e(O.OP_CAT);                          // ‖ suffix = the full parent tx
  e(O.OP_HASH256);                                       // = the parent txid
  pick(committedTxidAbs); e(O.OP_EQUALVERIFY);           // == committedTxid (the spent pool note's outpoint) ⟹ old-x is BOUND
  return { ops };
}

// off-chain helper: the 5-output set this leaf commits (for the test's belcoinjs sighash). stateOut = FRAME ‖ SHA256(state).
export function buyPoolLeafOutputs({ yp, poolSPK, xp, poolOwner, traderVal, traderSPK, tokenOut, traderOwner, changeVal, changeSPK }) {
  const _l8 = (v) => { const o = []; let t = BigInt(v); for (let i = 0; i < 8; i++) { o.push(t & 0xffn); t >>= 8n; } return Buffer.from(o.map(Number)); };
  const state = (ot, amt, owner) => Buffer.concat([B(0x02), B(ot), TOKEN_ID, _l8(amt), owner]);
  const stateScript = (ot, amt, owner) => Buffer.concat([B(0x6a, 0x20), S(state(ot, amt, owner))]);   // OP_RETURN ‖ PUSH32 ‖ SHA256(state)
  return [
    { value: Number(yp), script: poolSPK },
    { value: 0, script: stateScript(0x01, xp, poolOwner) },
    { value: Number(traderVal), script: traderSPK },
    { value: 0, script: stateScript(0x00, tokenOut, traderOwner) },
    { value: Number(changeVal), script: changeSPK },
  ];
}
