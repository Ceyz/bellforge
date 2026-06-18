// P2-0 BRICK (split-a-mono) — the GENESIS-ROOTED v2 leaves. The split-child leaf + the 1→1 send-all only spend split-CHILDREN
// (their kernel reconstructs a SPLIT parent). Nothing could spend the genesis MINT note — so the mono mint supply could never be
// divided or moved. This closes that: a genesis-AS-IMMEDIATE-PARENT kernel that reconstructs the mint tx byte-exact and parks the
// deploy CONSTANTS (owner_type_in=KEY, owner_in=OWNER_0, amount_in=AMOUNT_0) as the backtrace anchor (genesis has no parent to
// backtrace — the const stateOut0, hash-matched to the spent outpoint via c2, IS the closure). It then REUSES the proven
// conservation+c6+CSFS epilogue of splitFullLineageV2Ops / transferSendAllV2Ops VERBATIM via their additive {makeKernel, Wk, voutLe}
// override (Wk=4, voutLe=u32le(0)). So the highest-risk shared code is LITERALLY the same as the consensus-proven leaves.
//
// Design locked by the `split-a-mono-design` workflow (4 lenses + synthesis) + Claude's challenge. KEY arm ONLY (the mint note is
// always KEY-owned by OWNER_0). The children of a split-a-mono are ordinary split-children whose GRANDPARENT is the genesis mint —
// already covered by splitFullLineageGenesisGrandparentV2Ops (NO new grandparent shape). Two root-spend families:
//   splitAMonoV2Ops(M,N,...)     — the mint note → M split-children (the FIRST split; turns mono supply into divisible notes).
//   transferAMonoV2Ops(N,...)    — the mint note → ONE note at the FULL amount (send the whole undivided supply to a new owner).
// ⚠ ROOT FREEZE (workflow CRITICAL): the $BOUND genesis MUST be minted v2-66B (encodeStateV2). The v1 N9 non-divisible leaf MUST
// be EXCLUDED from the $BOUND taptree. Both root-spend families above (+ their M∈{2,3,4} fan-out) must be in the genesis taptree at
// MINT time — a forgotten root-spend leaf = the mint note is partially/totally unspendable forever (SPK is permanent).
import * as bells from 'belcoinjs-lib';
import { HDR_G, genMid, FRAME, VOUT0_LE, LOCKTIME0 } from './p1e3Const.mjs';
import { OwnerType, encodeStateV2, encodeAmount } from './wire.mjs';
import { u64 } from './sighashParts.mjs';
import { limbNum, limbSer, amountLimbsN } from './amounts.mjs';
import { splitFullLineageV2Ops } from './p1e3SplitFullLineageV2.mjs';
import { transferSendAllV2Ops } from './p1e3TransferV2.mjs';

const O = bells.opcodes;
const enc = bells.script.number.encode;
const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);

// the genesis-as-IMMEDIATE-parent kernel. Witness (deepest→top): genesisTxid(32)@0, mintOutpoint(36)@1, changeValGp(8)@2,
// changeSPKgp(34)@3 → W=4. Reconstructs the mint tx byte-exact (HDR_G ‖ mintOutpoint ‖ genMid(tokenId) ‖ VALUE_0‖0x22‖ownSPK ‖
// stateOut0[CONST = FRAME‖SHA256(encodeStateV2({KEY,tokenId,AMOUNT_0,OWNER_0}))] ‖ feeOut ‖ changeOut_gp ‖ LOCKTIME0), asserts
// hash256 == genesisTxid@0, then PARKS the deploy constants [owner_type_in, owner_in, amount_in] (amount_in on top) — the byte-
// identical altstack contract to splitParentReconstructV2Ops (so the shared epilogue reads them at Wtotal_eff..+2 verbatim).
// `extraAbove`/`ownSpkAbs` are supplied by the host leaf (makeKernel(extraAbove, ownSpkAbs)); ownSPK is the SAME register the
// epilogue's c4 binds to the real input scriptPubKey (genesis tokenNote0 splice ↔ c4 = one ownSPK, closes the decoupling escape).
export function monoGenesisReconstructV2Ops({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, extraAbove = 0, ownSpkAbs }) {
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(OWNER_0) || OWNER_0.length !== 20) throw new Error('OWNER_0 must be 20B');
  if (!Buffer.isBuffer(feeOut) || feeOut.length < 11) throw new Error('feeOut must be a serialized output (>=11B)');
  if (!Number.isInteger(ownSpkAbs) || ownSpkAbs < 4) throw new Error(`ownSpkAbs must be an integer >= 4 (above the W=4 kernel): ${ownSpkAbs}`);
  if (!Number.isInteger(extraAbove) || extraAbove < 0) throw new Error(`extraAbove must be a non-negative integer: ${extraAbove}`);
  // SINGLE-SOURCE the anti-inflation root (WELD-DIVERGENCE CRITICAL): the parked amount_in/owner_in/owner_type_in literals and the
  // hashed stateOut0 ALL derive from the SAME {AMOUNT_0, OWNER_0, tokenId}. amount_in MUST be the 8B frozen wire form (encodeAmount),
  // never a minimal CScriptNum (that would break the Step-5 weld |amount_ser|==8). encodeAmount rejects >=2^63 at build (top-limb cap).
  const amtSer = encodeAmount(AMOUNT_0);
  if (amtSer.length !== 8) throw new Error(`amount_in must serialize to exactly 8B: got ${amtSer.length}`);
  const stateOut0 = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const valPrefix = Buffer.concat([u64(VALUE_0), B(0x22)]);

  const committedAbs = 0, mintOutpointAbs = 1, changeValGpAbs = 2, changeSPKgpAbs = 3, W = 4;
  const ops = []; let depth = W + extraAbove;
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1, [O.OP_TOALTSTACK]: -1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_EQUALVERIFY]: -2 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };

  e(HDR_G);                                                                   // acc = version ‖ vinCount(02)
  pick(mintOutpointAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT);    // ‖ mintOutpoint (vin0 = the minter outpoint M)
  e(genMid(tokenId), O.OP_CAT);                                               // ‖ M-tail ‖ G ‖ G-tail ‖ voutCount(04)  (G baked → token_id bound)
  e(valPrefix); pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_CAT); // ‖ tokenNote0 = VALUE_0 ‖ 0x22 ‖ ownSPK
  e(stateOut0, O.OP_CAT, feeOut, O.OP_CAT);                                   // ‖ stateOut0 (v2 const, bakes AMOUNT_0/OWNER_0/KEY) ‖ feeOut (const)
  pick(changeValGpAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);               // changeValGp (|·|==8)
  pick(changeSPKgpAbs); e(O.OP_SIZE, enc(changeSpkLen), O.OP_EQUALVERIFY, B(changeSpkLen), O.OP_SWAP, O.OP_CAT, O.OP_CAT); // ‖ changeOut_gp
  e(O.OP_CAT, Buffer.from(LOCKTIME0), O.OP_CAT);                              // (acc ‖ changeOut_gp) ‖ nLockTime = txGP_mint
  e(O.OP_SHA256, O.OP_SHA256);                                               // genesisTxid = hash256(txGP_mint)
  pick(committedAbs); e(O.OP_EQUALVERIFY);                                    // == genesisTxid@0 (double-bound: c2 later pins it to the real spent outpoint)

  // PARK the deploy CONSTANTS as [owner_type_in, owner_in, amount_in] (amount_in on top) — same altstack order/contract as the split kernel.
  e(amtSer); e(O.OP_TOALTSTACK);                                             // amount_in  (altstack bottom)
  e(OWNER_0); e(O.OP_TOALTSTACK);                                            // owner_in
  e(B(OwnerType.KEY)); e(O.OP_TOALTSTACK);                                   // owner_type_in (altstack top)
  e(O.OP_FROMALTSTACK, O.OP_FROMALTSTACK, O.OP_FROMALTSTACK);                // [.., owner_type_in, owner_in, amount_in]
  return { ops, W };
}

const monoKernel = (consts) => (extraAbove, ownSpkAbs) => monoGenesisReconstructV2Ops({ ...consts, extraAbove, ownSpkAbs });

// split-a-mono: the mint note → M split-children. KEY arm, j=0, VOUT_LE=u32le(0) (genesis note at mint vout 0). NO grandparent.
// changeWitness threads the CURRENT-change witness (the genesis PARENT change is already the witness changeSPKgp in the mono kernel).
export function splitAMonoV2Ops(M, N, { tokenId, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, changeWitness = false }) {
  return splitFullLineageV2Ops(2 /* Mp placeholder, UNUSED — Wk comes from the override */, 0, M, N, {
    tokenId, changeSPK, arm: 'key', Wk: 4, voutLe: Buffer.from(VOUT0_LE), changeWitness,
    makeKernel: monoKernel({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen }),
  });
}
export const buildSplitAMonoV2Leaf = (M, N, consts) => bells.script.compile(splitAMonoV2Ops(M, N, consts).ops);

// send-all-the-mint-note: the mint note → ONE note at the FULL amount (move the whole undivided supply, no split). KEY arm, j=0.
export function transferAMonoV2Ops(N, { tokenId, changeSPK, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, changeWitness = false }) {
  return transferSendAllV2Ops(2 /* placeholder */, 0, N, {
    tokenId, changeSPK, arm: 'key', Wk: 4, voutLe: Buffer.from(VOUT0_LE), changeWitness,
    makeKernel: monoKernel({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen }),
  });
}
export const buildTransferAMonoV2Leaf = (N, consts) => bells.script.compile(transferAMonoV2Ops(N, consts).ops);

// ----- witness + tx builders (app/test side; the LEAF is the source of truth) -----
const pairs = (v, N) => { const L = amountLimbsN(BigInt(v), N); const w = []; for (let i = 0; i < N; i++) w.push(limbNum(L[i]), limbSer(L[i])); return w; };

// build the real genesis (mint) tx bytes + genesisTxid + the kernel's 4 witness fields. changeOut_gp is the operator's non-token
// genesis change (witness, |SPK|==changeSpkLen); mintOutpoint = the minter UTXO @ vin0; G is consumed at vin1 (baked in genMid).
export function monoGenesisTx({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, ownSPK, mintOutpoint, changeValGp, changeSPKgp }) {
  const stateOut0 = Buffer.concat([FRAME, S(encodeStateV2({ ownerType: OwnerType.KEY, tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
  const tx = Buffer.concat([HDR_G, mintOutpoint, genMid(tokenId), Buffer.concat([u64(VALUE_0), B(0x22), ownSPK]), stateOut0, feeOut, Buffer.concat([u64(changeValGp), B(0x22), changeSPKgp]), Buffer.from(LOCKTIME0)]);
  const genesisTxid = S(S(tx));
  return { tx, genesisTxid, genesis: { genesisTxid, mintOutpoint, changeValGp, changeSPKgp } };
}

// CWMONO-1 fix: the FROZEN root leaves are changeWitness=true (freezeEnumerate forces it), so their witness MUST carry the 2 CW
// fields ABOVE the base layout (curChangeSpk@cwBase=Wtotal, parChangeSpk@Wtotal+1) — the leaf reads curChangeSpk into c6 and the
// kernel ignores parChangeSpk (the mono parent change is the W=4 changeSPKgp). Pass curChangeSpk + parChangeSpk for the frozen ABI;
// OMIT both ONLY for a (legacy) changeWitness=false leaf. (Mirrors withChangeWitness in p1e3SplitFullLineageV2.mjs.)
const appendCW = (w, curChangeSpk, parChangeSpk) => {
  if (curChangeSpk === undefined && parChangeSpk === undefined) return w;  // changeWitness=false leaf — byte-identical to before
  for (const [n, b] of [['curChangeSpk', curChangeSpk], ['parChangeSpk', parChangeSpk]]) {
    if (!Buffer.isBuffer(b) || b.length !== 34) throw new Error(`${n} must be a 34B SPK for the changeWitness=true frozen ABI`);
  }
  return [...w, curChangeSpk, parChangeSpk];
};

// witness for splitAMonoV2Ops. genesis = {genesisTxid, mintOutpoint, changeValGp, changeSPKgp}; outs = M children; amountIn=AMOUNT_0.
// For the FROZEN (changeWitness=true) leaf, ALSO pass curChangeSpk + parChangeSpk (34B each).
export function splitAMonoV2Witness({ genesis, epi, ownSPK, changeValue, outs, amountIn, N = 8, curChangeSpk, parChangeSpk }) {
  const w = [genesis.genesisTxid, genesis.mintOutpoint, u64(genesis.changeValGp), genesis.changeSPKgp];
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue));
  for (const o of outs) w.push(o.owner, u64(o.value), B(o.ownerType));
  for (const o of outs) w.push(...pairs(o.amount, N));
  w.push(...pairs(amountIn, N));
  return appendCW(w, curChangeSpk, parChangeSpk);
}

// witness for transferAMonoV2Ops. out = the single re-emitted note {owner, value, ownerType}; amountIn (==AMOUNT_0) re-emitted whole.
// For the FROZEN (changeWitness=true) leaf, ALSO pass curChangeSpk + parChangeSpk (34B each).
export function transferAMonoV2Witness({ genesis, epi, ownSPK, changeValue, out, amountIn, curChangeSpk, parChangeSpk }) {
  const amtSer = encodeAmount(amountIn);
  const w = [genesis.genesisTxid, genesis.mintOutpoint, u64(genesis.changeValGp), genesis.changeSPKgp];
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue), out.owner, u64(out.value), B(out.ownerType), amtSer);
  return appendCW(w, curChangeSpk, parChangeSpk);
}
