// P2-0 BRICK 5 — the 1→1 SEND-ALL transfer leaf (v2, position-aware, KEY arm). Spends a KEY split-child note (child j @ vout 2j of
// a degree-Mp split parent) and re-emits ONE note carrying the FULL amount (amount_out == amount_in, byte-equality — no adder).
// This is MIN_OUT=1: the dedicated send-all path the freeze chose over a degenerate M=1 split. Reuses the v2 kernel (parks
// amount_in/owner_in/owner_type_in) + the position-aware c2 + the v2 stateOut + the CSFS/CHECKSIG epilogue + key-auth, all VERBATIM
// in spirit from splitFullLineageV2Ops, minus the conservation adder. The OUTPUT owner_type is FREE (validated ∈{0,1,2}) so a
// send-all can ALSO retarget key→script (a deposit) or script→key (a withdrawal). voutCount = 3 (tokenOut0 @0, stateOut0 @1, change @2).
import * as bells from 'belcoinjs-lib';
import { splitParentReconstructV2Ops } from './p1e3SplitLineageV2.mjs';
import { FRAME } from './p1e3Const.mjs';
import { STATE_V2_PREFIX, OwnerType } from './wire.mjs';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS, u32 } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

export function transferSendAllV2Ops(Mp, j, N, { tokenId, changeSPK, arm = 'key', makeKernel, Wk: WkOverride, voutLe, changeWitness = false }) {
  if (!Number.isInteger(Mp) || Mp < 1 || Mp > 4) throw new Error(`M' (parent degree) must be 1..4 (1=transfer-parent): ${Mp}`);
  if (!Number.isInteger(j) || j < 0 || j >= Mp) throw new Error(`j must be 0..${Mp - 1}: ${j}`);
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  // ADDITIVE default-identity override (genesis-rooted send-all reuse): a custom parent kernel + Wk + spent-note VOUT_LE. Absent ⟹
  // byte-for-byte the proven split-child 1→1 leaf. The send-all-the-MINT-NOTE leaf passes makeKernel=mono, Wk=4, voutLe=u32(0).
  const VOUT_LE = voutLe ?? u32(2 * j);

  const Wk = WkOverride ?? (3 + 4 * Mp);
  const sigAbs = Wk + 0, pAbs = Wk + 1, c1Abs = Wk + 2, c3Abs = Wk + 3, c5Abs = Wk + 4, c7Abs = Wk + 5, c8Abs = Wk + 6, c9Abs = Wk + 7;
  const ownSpkAbs = Wk + 8, changeAbs = Wk + 9, ownerOutAbs = Wk + 10, valueOutAbs = Wk + 11, ownerTypeOutAbs = Wk + 12, amountSerOutAbs = Wk + 13;
  const Wtotal = Wk + 14, committedAbs = 0;

  // SCRIPT arm (docs/SCRIPT_OWNED_ARM.md): the SAME controller co-spend as the split leaf. 4 extra witness fields ABOVE Wtotal feed
  // the 2-input c2/c4 + the owner-descriptor BIND. arm='key' ⟹ Wtotal_eff==Wtotal ⟹ the KEY send-all path is byte-unchanged.
  const SCRIPT = arm === 'script';
  const outpoint1Abs = Wtotal, ctrlSpkAbs = Wtotal + 1, poolIdAbs = Wtotal + 2, stateIdAbs = Wtotal + 3;
  // BRICK 2 — changeSPK witness (default-identity, same as the split leaf): 2 fields ABOVE the SCRIPT fields (current + parent change).
  const CW = changeWitness === true;
  const cwBase = Wtotal + (SCRIPT ? 4 : 0);
  const curChangeSpkAbs = cwBase, parChangeSpkAbs = cwBase + 1;
  const Wtotal_eff = Wtotal + (SCRIPT ? 4 : 0) + (CW ? 2 : 0);

  const kres = makeKernel
    ? makeKernel(Wtotal_eff - Wk, ownSpkAbs, CW ? parChangeSpkAbs : null)
    : splitParentReconstructV2Ops(Mp, j, { tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove: Wtotal_eff - Wk, ownSpkAbs, changeSpkAbs: CW ? parChangeSpkAbs : null });
  if (kres.W !== Wk) throw new Error(`kernel W=${kres.W} != leaf Wk=${Wk} — offset corruption`);
  const ops = [...kres.ops];
  const ownerTypeInAbs = Wtotal_eff, ownerInAbs = Wtotal_eff + 1, amountInAbs = Wtotal_eff + 2;
  let depth = Wtotal_eff + 3;

  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_EQUAL]: -1, [O.OP_CHECKSIG]: -1,
    [O.OP_EQUALVERIFY]: -2, [OP_CSFS]: -2, [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_NOT]: 0, [O.OP_HASH160]: 0, [O.OP_ROT]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };
  const vsOwn = () => { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY); e(B(0x22), O.OP_SWAP, O.OP_CAT); };
  const validateOwnerType = () => ops.push(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_DUP, B(0x00), O.OP_EQUAL, O.OP_OVER, B(0x01), O.OP_EQUAL, O.OP_BOOLOR, O.OP_OVER, B(0x02), O.OP_EQUAL, O.OP_BOOLOR, O.OP_VERIFY);

  // CONSERVATION (1→1): amount_ser_out == backtrace-proven amount_in (byte-equality; the full amount is re-emitted).
  pick(amountSerOutAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); pick(amountInAbs); e(O.OP_EQUALVERIFY);

  // c6 = SHA256( tokenOut0 ‖ stateOut0 ‖ changeOut ).
  pick(valueOutAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); vsOwn(); e(O.OP_CAT);             // tokenOut0 = value_out ‖ 0x22‖ownSPK
  e(STATE_V2_PREFIX); pick(ownerTypeOutAbs); validateOwnerType(); e(O.OP_CAT);                 // 0x02 ‖ owner_type_out
  e(tokenId, O.OP_CAT);                                                                        // ‖ token_id
  pick(amountSerOutAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY, O.OP_CAT);                      // ‖ amount_ser_out
  pick(ownerOutAbs); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); // -> stateOut0
  e(O.OP_CAT);                                                                                 // tokenOut0 ‖ stateOut0
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                                      // changeVal pinned
  if (CW) { pick(curChangeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT); } // changeOut (witness changeSPK)
  else e(vsChange, O.OP_CAT);                                                                   // changeOut (const changeSPK)
  e(O.OP_CAT);                                                                                 // ‖ changeOut
  e(O.OP_SHA256);                                                                              // c6 = sha_outputs (3-output)

  // EPILOGUE — bind c6 to the real sighash + KEY owner-auth (same tail as splitFullLineageV2Ops).
  if (CW) { pick(ownSpkAbs); pick(curChangeSpkAbs); e(O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); }     // ownSPK != changeSPK (witness)
  else { pick(ownSpkAbs); e(vsChange.subarray(1), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); }         // ownSPK != changeSPK (const)
  e(O.OP_TOALTSTACK);                                                                          // stash c6
  pick(c1Abs);
  pick(committedAbs); e(VOUT_LE, O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY);
  if (SCRIPT) { pick(outpoint1Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT); }        // 2-input shaPrevouts
  e(O.OP_SHA256, O.OP_CAT);                                                                    // ‖ c2 (position-aware)
  pick(c3Abs); e(O.OP_CAT);
  vsOwn();
  if (SCRIPT) { pick(ctrlSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT); } // ‖ varslice(controllerSPK)
  e(O.OP_SHA256, O.OP_CAT);                                                                    // ‖ c4
  pick(c5Abs); e(O.OP_CAT);
  e(O.OP_FROMALTSTACK, O.OP_CAT);                                                              // ‖ c6
  pick(c7Abs); e(O.OP_CAT); pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT);
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);
  pick(pAbs); pick(sigAbs); pins();
  e(O.OP_ROT, O.OP_ROT, OP_CSFS, O.OP_VERIFY);
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY);
  if (SCRIPT) {
    // SCRIPT arm: the controller co-spend authorizes (c4 already forced controllerSPK @ vin1). NO owner-key check; owner_in BINDs the
    // controller INSTANCE (hash160(controllerSPK ‖ pool_id ‖ state_id)). A send-all can thus WITHDRAW a SCRIPT note → key/script/burn.
    pick(ownerTypeInAbs); e(B(OwnerType.SCRIPT), O.OP_EQUALVERIFY);
    pick(ctrlSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY);
    pick(poolIdAbs); e(O.OP_SIZE, enc(32), O.OP_EQUALVERIFY, O.OP_CAT);
    pick(stateIdAbs); e(O.OP_SIZE, enc(32), O.OP_EQUALVERIFY, O.OP_CAT);
    e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY);   // owner_in == hash160(controllerSPK ‖ pool_id ‖ state_id)
  } else {
    pick(ownerTypeInAbs); e(B(OwnerType.KEY), O.OP_EQUALVERIFY);                               // KEY arm
    pick(pAbs); e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY);                        // hash160(P)==owner_in
  }
  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);
  ops.push(O.OP_1);
  return { ops, Wk, Wtotal };
}
export const buildTransferSendAllV2Leaf = (Mp, j, N, consts) => bells.script.compile(transferSendAllV2Ops(Mp, j, N, consts).ops);

// witness (deepest→top): the v2 kernel witness ‖ sig,P,c1,c3,c5,c7,c8,c9, ownSPK, changeValue, owner_out, value_out, owner_type_out, amount_ser_out.
import { splitParentV2Witness } from './p1e3SplitLineageV2.mjs';
export function transferSendAllV2Witness({ parent, epi, ownSPK, changeValue, out, amountIn }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const amtSer = (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(amountIn)); return b; })();
  const w = splitParentV2Witness(parent);
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue), out.owner, u64(out.value), B(out.ownerType), amtSer);
  return w;
}
// SCRIPT-arm send-all witness = the KEY witness ‖ the 4 controller fields (outpoint1, controllerSPK, pool_id, state_id) ABOVE it.
export function transferSendAllV2ScriptWitness(args) {
  const { outpoint1, controllerSPK, poolId, stateId } = args.script;
  return [...transferSendAllV2Witness(args), outpoint1, controllerSPK, poolId, stateId];
}
