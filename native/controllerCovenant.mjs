// P2-0 BRICK 11 (genesis-EXTERNAL) — the toy NO-ESCAPE CONTROLLER covenant: what closes B-SCRIPT (a permissive/dummy controllerSPK ⇒
// theft of SCRIPT notes). Design locked by the `noescape-controller-design` workflow (4 lenses+synth). The $BOUND token leaf is
// controller-AGNOSTIC — it only proves "an input at my committed controllerSPK is co-spent." The controller covenant proves the
// co-spent input is a REAL controller instance (its OWN state lineage), so a DUMMY UTXO funded at the public controllerSPK has NO
// lineage ⟹ unspendable ⟹ cannot authorize. This is the C-1 no-escape pattern (native/p1e3_c1_noescape_regtest) applied to the controller.
//
// THE CONTROLLER ADDRESS: controllerSPK = P2TR(NUMS-dead, single tapleaf), NO key-path / NO admin branch (kills the permissive +
// key-escape attacks STRUCTURALLY). pool_id is a LEAF CONSTANT = the controller's OWN genesis-outpoint hash ⟹ controllerSPK DEPENDS on
// pool_id ⟹ template-sibling pools have DIFFERENT controllerSPK (cross-instance blocked at the SPK layer, STRONGER than the doc's L7).
//
// BRICK 1 (this file, first cut): the controller STATE encoding + the controller GENESIS tx (mints the first controller note, bakes
// pool_id). The 2-input self-replicating no-escape LEAF (depth-2 lineage + re-emit + inIndex==1) is BRICK 2. The on-node GREEN
// round-trip + the RED battery {dummy-UTXO, cross-instance, permissive-vs-no-escape, key-escape, ACP-detach} are BRICK 3-4.
import * as bells from 'belcoinjs-lib';
import { FRAME, HDR_G, genMid, VOUT0_LE, LOCKTIME0 } from './p1e3Const.mjs';
import { u64, TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const S = bells.crypto.sha256;
const B = (...x) => Buffer.from(x);

// the controller's committed STATE (minimal, toy): a version byte 0x03 (distinct from the token's 0x01/0x02 state prefixes) ‖
// pool_id(36) ‖ state_id(36). For the toy round-trip state_id == pool_id (a CONSTANT identity — see the production split note below).
// 73B preimage → SHA256 → the 32B committed in the stateOut. pool_id/state_id are 36B (the same width as a token_id / outpoint-hash
// domain). The $BOUND SCRIPT note's owner descriptor uses the 32B pool_id/state_id (hash160(controllerSPK(34)‖pool_id(32)‖state_id(32)))
// — so the controller commits the 32B form; this state is the controller's OWN ledger (the $BOUND indexer never reads it).
export const CONTROLLER_STATE_PREFIX = B(0x03);
export function encodeControllerState({ poolId, stateId }) {
  if (!Buffer.isBuffer(poolId) || poolId.length !== 32) throw new Error('poolId must be 32B');
  if (!Buffer.isBuffer(stateId) || stateId.length !== 32) throw new Error('stateId must be 32B');
  return Buffer.concat([CONTROLLER_STATE_PREFIX, poolId, stateId]);           // 1 + 32 + 32 = 65B
}
export const controllerStateOut = (st) => Buffer.concat([FRAME, S(encodeControllerState(st))]); // FRAME(11) ‖ SHA256(state) = 43B

// pool_id = the controller's OWN genesis outpoint hash = SHA256(genesisOutpoint(36)). This BINDS the controller instance to a unique
// genesis (a dummy UTXO, and a template-sibling pool, get a DIFFERENT pool_id) AND is the value the $BOUND SCRIPT note commits to.
export const poolIdFromGenesisOutpoint = (genesisOutpoint) => {
  if (!Buffer.isBuffer(genesisOutpoint) || genesisOutpoint.length !== 36) throw new Error('genesisOutpoint must be 36B (txid32 ‖ vout4)');
  return S(genesisOutpoint);
};

// BRICK 2 (first cut) — the TOY no-escape controller LEAF: a genesis-only ONE-SHOT covenant. The controller note (genesis out0) is
// spent DIRECTLY (depth-1) by reconstructing the controller-genesis byte-exact (hash256==committedTxidP); a DUMMY UTXO at controllerSPK
// has a non-genesis parent ⟹ its committedTxidP != hash256(the baked genesis) ⟹ unspendable ⟹ cannot authorize (the keystone B-SCRIPT
// closure). It binds the 2-INPUT sighash from the controller's vantage (inIndex==1, the controller is at vin1 in the SCRIPT-arm
// co-spend): c2=SHA256(vin0_outpoint ‖ controller_outpoint), c4=SHA256(vslice(vin0_spk) ‖ vslice(controllerSPK)), c7=0x02‖u32le(1)
// BAKED (refuses ACP/SINGLE/annex detach). c6 is a FREE pass-through (the controller does NOT constrain outputs — that is the token
// leaf's job). pool_id is baked via the const stateOut0 (= the right instance). NO re-emit (one-shot toy; depth-2 self-replication for
// perpetual pools is the next brick). u32le helper inline.
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export function controllerLeafOps({ CG, minterOutpoint, VALUE_0, feeOut, changeSpkLen = 34 }) {
  if (!Buffer.isBuffer(CG) || CG.length !== 36) throw new Error('CG must be 36B');
  if (!Buffer.isBuffer(minterOutpoint) || minterOutpoint.length !== 36) throw new Error('minterOutpoint must be 36B');
  if (!Buffer.isBuffer(feeOut) || feeOut.length < 11) throw new Error('feeOut must be a serialized output');
  const poolId = poolIdFromGenesisOutpoint(minterOutpoint), stateId = poolId;       // toy: state_id == pool_id, both baked via stateOut0
  const stateOut0 = controllerStateOut({ poolId, stateId });                         // const (bakes pool_id ⟹ this is THE instance)
  const valPrefix = Buffer.concat([u64(VALUE_0), B(0x22)]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  const C7_VIN1 = Buffer.concat([B(0x02), u32le(1)]);                                // mid = spendType 0x02 (no annex) ‖ inIndex 1

  const committedAbs = 0, vin0OutpointAbs = 1, vin0SpkAbs = 2, controllerSpkAbs = 3, changeValAbs = 4, changeSpkAbs = 5;
  const sigAbs = 6, pAbs = 7, c1Abs = 8, c3Abs = 9, c5Abs = 10, c6Abs = 11, c8Abs = 12, c9Abs = 13, W = 14;

  const ops = []; let depth = W;
  const DELTA = { [O.OP_SIZE]: 1, [O.OP_CAT]: -1, [O.OP_SHA256]: 0, [O.OP_SWAP]: 0, [O.OP_ROT]: 0, [O.OP_EQUALVERIFY]: -2,
    [O.OP_VERIFY]: -1, [O.OP_DROP]: -1, [O.OP_CHECKSIG]: -1, [OP_CSFS]: -2, [O.OP_1]: 1 };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };                          // net-0 (asserts |P|==32,|sig|==64; precond [..,P,sig])

  // (1) reconstruct the controller GENESIS byte-exact → hash256 == committedTxidP@0 (a dummy's parent cannot match).
  e(HDR_G); e(minterOutpoint, O.OP_CAT); e(genMid(CG), O.OP_CAT);                     // version‖02 ‖ minterOutpoint ‖ genMid(CG bakes the genesis-id)
  e(valPrefix); pick(controllerSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_CAT); // controllerNote0 = VALUE_0‖0x22‖controllerSPK
  e(stateOut0, O.OP_CAT, feeOut, O.OP_CAT);                                          // ‖ stateOut0(const, bakes pool_id) ‖ feeOut(const)
  pick(changeValAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);
  pick(changeSpkAbs); e(O.OP_SIZE, enc(changeSpkLen), O.OP_EQUALVERIFY, B(changeSpkLen), O.OP_SWAP, O.OP_CAT, O.OP_CAT); // ‖ changeOut
  e(O.OP_CAT, Buffer.from(LOCKTIME0), O.OP_CAT);                                     // ‖ changeOut ‖ locktime = the genesis tx
  e(O.OP_SHA256, O.OP_SHA256); pick(committedAbs); e(O.OP_EQUALVERIFY);             // hash256 == committedTxidP (the controller note's prev-txid)

  // (2) assemble the 2-input sighash (inIndex==1) + bind via CSFS+CHECKSIG. message = PREFIX ‖ c1‖c2‖c3‖c4‖c5‖c6‖c7‖c8‖c9.
  pick(c1Abs);                                                                       // c1 (pre)
  pick(vin0OutpointAbs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY);                    // vin0 outpoint (the co-spent SCRIPT note, forge-bait until c2 binds)
  pick(committedAbs); e(Buffer.from(VOUT0_LE), O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY); // controller outpoint = committedTxidP ‖ vout0
  e(O.OP_CAT, O.OP_SHA256, O.OP_CAT);                                               // c2 = SHA256(vin0 ‖ controller) [2-input shaPrevouts] ; ‖ into msg
  pick(c3Abs); e(O.OP_CAT);                                                          // ‖ c3
  pick(vin0SpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT);   // vslice(vin0_spk)
  pick(controllerSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT); // vslice(controllerSPK) [self-replication register]
  e(O.OP_CAT, O.OP_SHA256, O.OP_CAT);                                               // c4 = SHA256(vslice(vin0)‖vslice(ctrl)) [2-input] ; ‖ into msg
  pick(c5Abs); e(O.OP_CAT);                                                          // ‖ c5
  pick(c6Abs); e(O.OP_CAT);                                                          // ‖ c6 (FREE — the controller does not constrain outputs)
  e(C7_VIN1, O.OP_CAT);                                                              // ‖ c7 = 0x02‖u32le(1) BAKED (no-annex, inIndex==1)
  pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT);                                // ‖ c8 ‖ c9
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                                       // computed_sighash = SHA256(PREFIX ‖ message)
  pick(pAbs); pick(sigAbs); pins();
  e(O.OP_ROT, O.OP_ROT, OP_CSFS, O.OP_VERIFY);                                       // CSFS: computed == real ⟹ c2/c4/c7 are the real 2-input vin1 sighash
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY);               // CHECKSIG over the real sighash (the ephemeral binder)

  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);                              // CLEANSTACK
  ops.push(O.OP_1);
  return { ops, W, poolId };
}
export const buildControllerLeaf = (consts) => bells.script.compile(controllerLeafOps(consts).ops);

// the controller GENESIS tx (2-input mint, mirrors the token's genesis shape so the controller leaf's grandparent arm can reconstruct
// it byte-exact): HDR_G ‖ minterOutpoint(36) ‖ genMid(CG) ‖ controllerNote0(VALUE_0‖0x22‖controllerSPK) ‖ stateOut0 ‖ feeOut ‖ change ‖
// LOCKTIME0. CG (the controller's genesis-id, baked in genMid like the token bakes G) = a 36B operator const. The controller note is
// out0 @ vout0, committing pool_id = SHA256(this tx's vin0 outpoint = the minter outpoint) and state_id == pool_id (toy).
// ⚠ feeOut/change MUST be operator keys (NOT an uncomputable fee-covenant), else the controller's own grandparent EQUALVERIFY bricks
// its lineage (the same trap as the token's genesis). Returns the legacy bytes + genesisTxid + the derived pool_id + the state fields.
export function controllerGenesisTx({ CG, controllerSPK, VALUE_0, feeOut, minterOutpoint, changeVal, changeSPK }) {
  if (!Buffer.isBuffer(CG) || CG.length !== 36) throw new Error('CG (controller genesis-id) must be 36B');
  if (!Buffer.isBuffer(controllerSPK) || controllerSPK.length !== 34) throw new Error('controllerSPK must be 34B (P2TR)');
  if (!Buffer.isBuffer(minterOutpoint) || minterOutpoint.length !== 36) throw new Error('minterOutpoint must be 36B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  const poolId = poolIdFromGenesisOutpoint(minterOutpoint);                   // the controller's pool_id = SHA256(its genesis vin0 outpoint)
  const stateId = poolId;                                                      // toy: state_id == pool_id (stable pool-identity)
  const stateOut0 = controllerStateOut({ poolId, stateId });
  const tokenNote0 = Buffer.concat([u64(VALUE_0), B(0x22), controllerSPK]);
  const changeOut = Buffer.concat([u64(changeVal), B(0x22), changeSPK]);
  const tx = Buffer.concat([HDR_G, minterOutpoint, genMid(CG), tokenNote0, stateOut0, feeOut, changeOut, Buffer.from(LOCKTIME0)]);
  return { tx, genesisTxid: S(S(tx)), poolId, stateId, stateOut0, genesis: { CG, minterOutpoint, changeVal, changeSPK } };
}
