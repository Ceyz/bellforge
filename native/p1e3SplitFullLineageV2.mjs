// P2-0 BRICK 0 — the STATE v2 composed split-child leaf (the KEY-owned arm). Mirrors splitFullLineageOps VERBATIM except the
// +1-byte owner_type shift everywhere it touches the state preimage + the witness layout, plus two new v2 gates:
//   (1) PHASE B builds each child stateOut from the v2 preimage 0x02 ‖ owner_type_j ‖ token_id ‖ amount_ser_j ‖ owner_j and
//       VALIDATES owner_type_j ∈ {0,1,2} (byte-equality) — the output owner_types stay FREE (key/script/burn) so a key→script
//       deposit composes; the wire-accepts==spendable invariant (no stuck owner_type=5 note can be created).
//   (2) PHASE C asserts owner_type_in == KEY (0x00) — this is the KEY leaf; the auth arm is SELECTED by the backtrace-proven
//       input-side owner_type (a SCRIPT note must use the script-owned leaf, BRICK 8; a BURN note is terminal). Then key-auth.
// Built ALONGSIDE the proven v1 splitFullLineageOps (separate file) so the +1-byte offset shift is diffable + auditable (the
// critic's BRICK-0 #1 risk). Witness adds owner_type_k per parent output (kernel) + owner_type_j per current output.
import * as bells from 'belcoinjs-lib';
import { splitParentReconstructV2Ops } from './p1e3SplitLineageV2.mjs';
import { limbConsistencyVerifyOps } from './amounts.mjs';
import { FRAME } from './p1e3Const.mjs';
import { STATE_V2_PREFIX, OwnerType } from './wire.mjs';
import { TAPSIGHASH_TAG, CSFS_PUBKEY_SIG_PINS, u32 } from './sighashParts.mjs';

const O = bells.opcodes;
const OP_CSFS = 0xcc;
const enc = bells.script.number.encode;
const B = (...x) => Buffer.from(x);

export function splitFullLineageV2Ops(Mp, j, M, N, { tokenId, changeSPK, arm = 'key', makeKernel, Wk: WkOverride, voutLe, changeWitness = false }) {
  if (!Number.isInteger(Mp) || Mp < 1 || Mp > 4) throw new Error(`M' (parent degree) must be 1..4 (1=transfer-parent): ${Mp}`);
  if (!Number.isInteger(j) || j < 0 || j >= Mp) throw new Error(`j must be 0..${Mp - 1}: ${j}`);
  if (!Number.isInteger(M) || M < 2 || M > 4) throw new Error(`M (current split degree) must be 2..4: ${M}`);
  if (!Number.isInteger(N) || N < 1 || N > 8) throw new Error(`N must be 1..8: ${N}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId must be 36B');
  if (!Buffer.isBuffer(changeSPK) || changeSPK.length !== 34) throw new Error('changeSPK must be 34B');
  const vsChange = Buffer.concat([B(0x22), changeSPK]);
  const PREFIX = Buffer.concat([TAPSIGHASH_TAG, TAPSIGHASH_TAG, B(0x00)]);
  // ----- ADDITIVE default-identity override (split-a-mono reuse): a custom parent KERNEL + Wk + the spent-note VOUT_LE. When all
  //       three are absent the op stream is byte-for-byte the proven split-child leaf (the 15+ KEY/SCRIPT/grandparent callers +
  //       consensus vectors are untouched). The mono-genesis leaf passes makeKernel=monoGenesisReconstructV2Ops, Wk=4, voutLe=u32(0).
  const VOUT_LE = voutLe ?? u32(2 * j);

  // ----- v2 witness layout: kernel W_k = 3 + 4·Mp (owner_type_k added); the current outputs carry 3 fields (owner_j, value_j,
  //       owner_type_j); the kernel parks 3 items (owner_type_in, owner_in, amount_in).
  const Wk = WkOverride ?? (3 + 4 * Mp);
  const sigAbs = Wk + 0, pAbs = Wk + 1, c1Abs = Wk + 2, c3Abs = Wk + 3, c5Abs = Wk + 4, c7Abs = Wk + 5, c8Abs = Wk + 6, c9Abs = Wk + 7;
  const ownSpkAbs = Wk + 8, changeAbs = Wk + 9;
  const ownerAbs = (jj) => Wk + 10 + 3 * jj, valueAbs = (jj) => Wk + 10 + 3 * jj + 1, ownerTypeAbs = (jj) => Wk + 10 + 3 * jj + 2;
  const childBase = Wk + 10 + 3 * M;
  const outNumAbs = (jj, i) => childBase + (jj * N + i) * 2, outSerAbs = (jj, i) => childBase + (jj * N + i) * 2 + 1;
  const tgtBase = childBase + 2 * M * N;
  const tgtNumAbs = (i) => tgtBase + 2 * i, tgtSerAbs = (i) => tgtBase + 2 * i + 1;
  const Wtotal = tgtBase + 2 * N;
  const committedAbs = 0;
  // SCRIPT arm (workflow-designed, docs/SCRIPT_OWNED_ARM.md): the auth is the CONTROLLER CO-SPEND (no owner key). 4 extra witness
  // fields go ABOVE the KEY layout (so EVERY KEY abs is byte-identical): outpoint1 (the controller @ vin1) + controllerSPK feed the
  // 2-input c2/c4; pool_id + state_id feed the owner-descriptor BIND. arm='key' ⟹ Wtotal_eff==Wtotal ⟹ the KEY path is unchanged.
  const SCRIPT = arm === 'script';
  const outpoint1Abs = Wtotal, ctrlSpkAbs = Wtotal + 1, poolIdAbs = Wtotal + 2, stateIdAbs = Wtotal + 3;
  // BRICK 2 — changeSPK as a spender-chosen WITNESS (default-identity: changeWitness=false ⟹ the baked const, byte-identical). 2
  // fields ABOVE the SCRIPT fields: the CURRENT tx change (c6-bound) + the PARENT tx change (kernel reconstruction, committedTxidP-
  // bound). No field BELOW Wtotal shifts ⟹ the indexer ABI + every KEY/SCRIPT offset stay intact. Frees each spender's sat-change
  // from a single baked address (the centralization/permanence trap) — REQUIRED before the taptree freeze.
  const CW = changeWitness === true;
  const cwBase = Wtotal + (SCRIPT ? 4 : 0);
  const curChangeSpkAbs = cwBase, parChangeSpkAbs = cwBase + 1;
  const Wtotal_eff = Wtotal + (SCRIPT ? 4 : 0) + (CW ? 2 : 0);

  const kres = makeKernel
    ? makeKernel(Wtotal_eff - Wk, ownSpkAbs, CW ? parChangeSpkAbs : null) // the override kernel (mono-genesis): reconstructs a DIFFERENT parent
    : splitParentReconstructV2Ops(Mp, j, { tokenId, ownSPK: Buffer.alloc(34), changeSPK, extraAbove: Wtotal_eff - Wk, ownSpkAbs, changeSpkAbs: CW ? parChangeSpkAbs : null });
  if (kres.W !== Wk) throw new Error(`kernel W=${kres.W} != leaf Wk=${Wk} — offset corruption (the kernel's bottom witness count MUST equal Wk)`);
  const ops = [...kres.ops];
  const ownerTypeInAbs = Wtotal_eff, ownerInAbs = Wtotal_eff + 1, amountInAbs = Wtotal_eff + 2; // kernel parks owner_type_in, owner_in, amount_in
  let depth = Wtotal_eff + 3;

  const DELTA = {
    [O.OP_0]: 1, [O.OP_1]: 1, [O.OP_DUP]: 1, [O.OP_SIZE]: 1, [O.OP_FROMALTSTACK]: 1,
    [O.OP_TOALTSTACK]: -1, [O.OP_DROP]: -1, [O.OP_VERIFY]: -1, [O.OP_CAT]: -1, [O.OP_ADD]: -1, [O.OP_SUB]: -1,
    [O.OP_GREATERTHANOREQUAL]: -1, [O.OP_LESSTHAN]: -1, [O.OP_EQUAL]: -1, [O.OP_CHECKSIG]: -1,
    [O.OP_EQUALVERIFY]: -2, [O.OP_NUMEQUALVERIFY]: -2, [OP_CSFS]: -2,
    [O.OP_SWAP]: 0, [O.OP_SHA256]: 0, [O.OP_1ADD]: 0, [O.OP_NOT]: 0, [O.OP_HASH160]: 0, [O.OP_ROT]: 0,
  };
  const e = (...xs) => { for (const x of xs) { ops.push(x); depth += Buffer.isBuffer(x) ? 1 : (DELTA[x] ?? 0); } };
  const pick = (abs) => { ops.push(enc(depth - 1 - abs), O.OP_PICK); depth += 1; };
  const gadget = () => { ops.push(...limbConsistencyVerifyOps()); depth -= 2; };
  const pins = () => { ops.push(...CSFS_PUBKEY_SIG_PINS); };
  const reduceOne = [O.OP_DUP, enc(256), O.OP_GREATERTHANOREQUAL, O.OP_IF, enc(256), O.OP_SUB, O.OP_SWAP, O.OP_1ADD, O.OP_SWAP, O.OP_ENDIF];
  const vsOwn = () => { pick(ownSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY); e(B(0x22), O.OP_SWAP, O.OP_CAT); };
  // validate the owner_type byte on top ∈ {0x00,0x01,0x02} (byte-equality; the byte 0x00 is not a valid CScriptNum so NO numeric
  // compare). Net stack 0 (leaves the value). Pushed RAW — no inner pick, so depth is unchanged.
  const validateOwnerType = () => ops.push(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_DUP, B(0x00), O.OP_EQUAL, O.OP_OVER, B(0x01), O.OP_EQUAL, O.OP_BOOLOR, O.OP_OVER, B(0x02), O.OP_EQUAL, O.OP_BOOLOR, O.OP_VERIFY);

  // PHASE B — single-source amount_ser_j → v2 stateOut_j/tokenOut_j → the c6 preimage (alt).
  e(O.OP_0, O.OP_TOALTSTACK);                                  // c6preimage = empty
  for (let jj = 0; jj < M; jj++) {
    e(O.OP_0);                                                 // amount_ser_jj acc
    for (let i = 0; i < N; i++) { pick(outNumAbs(jj, i)); pick(outSerAbs(jj, i)); gadget(); pick(outSerAbs(jj, i)); e(O.OP_CAT); }
    e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);                    // |amount_ser_jj|==8
    // v2 state preimage = 0x02 ‖ owner_type_jj ‖ token_id ‖ amount_ser_jj ‖ owner_jj
    e(STATE_V2_PREFIX); pick(ownerTypeAbs(jj)); validateOwnerType(); e(O.OP_CAT);   // 0x02 ‖ owner_type_jj (validated ∈{0,1,2})
    e(tokenId, O.OP_CAT);                                      // ‖ token_id
    e(O.OP_SWAP, O.OP_CAT);                                    // (0x02‖owner_type_jj‖token_id) ‖ amount_ser_jj
    pick(ownerAbs(jj)); e(O.OP_SIZE, enc(20), O.OP_EQUALVERIFY, O.OP_CAT, O.OP_SHA256, FRAME, O.OP_SWAP, O.OP_CAT); // ‖ owner_jj -> stateOut_jj
    pick(valueAbs(jj)); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY); vsOwn(); e(O.OP_CAT); // tokenOut_jj = value_jj ‖ 0x22‖ownSPK ; [.., stateOut_jj, tokenOut_jj]
    e(O.OP_SWAP, O.OP_CAT);                                    // piece_jj
    e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_TOALTSTACK); // c6preimage ‖= piece_jj
  }
  pick(changeAbs); e(O.OP_SIZE, enc(8), O.OP_EQUALVERIFY);     // changeVal pinned
  if (CW) { pick(curChangeSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT); } // changeOut (witness changeSPK)
  else e(vsChange, O.OP_CAT);                                  // changeOut (const changeSPK)
  e(O.OP_FROMALTSTACK, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);      // c6 = SHA256(c6preimage ‖ changeOut)

  // PHASE A — conservation Σ(children) == target (= amount_in). VERBATIM.
  e(O.OP_0, O.OP_TOALTSTACK);
  for (let i = 0; i < N; i++) {
    pick(tgtNumAbs(i)); pick(tgtSerAbs(i)); gadget();
    e(O.OP_FROMALTSTACK);
    for (let jj = 0; jj < M; jj++) { pick(outNumAbs(jj, i)); e(O.OP_ADD); }
    e(O.OP_0, O.OP_SWAP);
    for (let k = 0; k < M - 1; k++) ops.push(...reduceOne);
    if (i === N - 1) ops.push(O.OP_DUP, enc(128), O.OP_LESSTHAN, O.OP_VERIFY);
    pick(tgtNumAbs(i)); e(O.OP_NUMEQUALVERIFY);
    e(O.OP_TOALTSTACK);
  }
  e(O.OP_FROMALTSTACK, O.OP_0, O.OP_NUMEQUALVERIFY);          // carry-out == 0 ; c6 on top

  // STEP 5 weld — target serializes to amount_in (re-witness 8 tgt b_ser, == amount_in). (Kept after PHASE A; reads amount_in.)
  // (folded here to keep PHASE A verbatim; the weld is order-free since it only reads fixed-abs items.)
  e(O.OP_0);
  for (let i = 0; i < N; i++) { pick(tgtSerAbs(i)); e(O.OP_SIZE, enc(1), O.OP_EQUALVERIFY, O.OP_CAT); }
  e(O.OP_SIZE, enc(N), O.OP_EQUALVERIFY);
  pick(amountInAbs); e(O.OP_EQUALVERIFY);                     // amount_ser_target == backtrace-proven amount_in

  // PHASE C — bind c6 to the REAL sighash + KEY owner-auth gated on owner_type_in==KEY.
  if (CW) { pick(ownSpkAbs); pick(curChangeSpkAbs); e(O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); } // ownSPK != changeSPK (witness)
  else { pick(ownSpkAbs); e(vsChange.subarray(1), O.OP_EQUAL, O.OP_NOT, O.OP_VERIFY); }      // ownSPK != changeSPK (const)
  e(O.OP_TOALTSTACK);                                         // stash c6
  pick(c1Abs);
  // c2: KEY arm = SHA256(outpoint0) [single input]; SCRIPT arm = SHA256(outpoint0 ‖ outpoint1) [2-input shaPrevouts]. outpoint0 =
  // committedTxidP ‖ u32le(2j) is byte-identical (NOTE-FIRST) — the position-aware binding is preserved; we just defer the SHA256
  // and insert the pinned controller outpoint1 BEFORE it (the workflow's c2 CRUX). note-first ⟹ note@vin0 is STRUCTURAL.
  pick(committedAbs); e(VOUT_LE, O.OP_CAT, O.OP_SIZE, enc(36), O.OP_EQUALVERIFY);
  if (SCRIPT) { pick(outpoint1Abs); e(O.OP_SIZE, enc(36), O.OP_EQUALVERIFY, O.OP_CAT); }
  e(O.OP_SHA256, O.OP_CAT);                                   // ‖ c2
  pick(c3Abs); e(O.OP_CAT);
  // c4: KEY = SHA256(varslice(ownSPK)); SCRIPT = SHA256(varslice(ownSPK) ‖ varslice(controllerSPK)) [2-input shaScriptPubKeys] —
  // forces vinCount==2 ∧ input[1].spk==controllerSPK (the Q1-proven hook), no vinCount opcode. ownSPK @ vin0 = self-replication.
  vsOwn();
  if (SCRIPT) { pick(ctrlSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY, B(0x22), O.OP_SWAP, O.OP_CAT, O.OP_CAT); }
  e(O.OP_SHA256, O.OP_CAT);                                   // ‖ c4
  pick(c5Abs); e(O.OP_CAT);
  e(O.OP_FROMALTSTACK, O.OP_CAT);                             // ‖ c6
  pick(c7Abs); e(O.OP_CAT); pick(c8Abs); e(O.OP_CAT); pick(c9Abs); e(O.OP_CAT); // message
  e(PREFIX, O.OP_SWAP, O.OP_CAT, O.OP_SHA256);                // computed_sighash
  pick(pAbs); pick(sigAbs); pins();
  e(O.OP_ROT, O.OP_ROT);
  e(OP_CSFS, O.OP_VERIFY);                                    // CSFS: computed == real ⟹ c6 == real shaOutputs ∧ c2 == real shaPrevouts
  pick(pAbs); pick(sigAbs); e(O.OP_SWAP, O.OP_CHECKSIG, O.OP_VERIFY); // CHECKSIG over the real sighash ((sig,P) = the introspection binder)
  if (SCRIPT) {
    // SCRIPT arm: the auth is the CONTROLLER CO-SPEND (already forced by c4 == controllerSPK @ vin1). NO owner-key check — P is purely
    // the introspection ephemeral. The arm is SELECTED by owner_type_in==SCRIPT, and owner_in BINDS the controller INSTANCE
    // (hash160(controllerSPK ‖ pool_id ‖ state_id)) so a wrong controller / cross-instance / pool-id is rejected (freeze [11]).
    pick(ownerTypeInAbs); e(B(OwnerType.SCRIPT), O.OP_EQUALVERIFY);
    pick(ctrlSpkAbs); e(O.OP_SIZE, enc(34), O.OP_EQUALVERIFY);
    pick(poolIdAbs); e(O.OP_SIZE, enc(32), O.OP_EQUALVERIFY, O.OP_CAT);
    pick(stateIdAbs); e(O.OP_SIZE, enc(32), O.OP_EQUALVERIFY, O.OP_CAT);
    e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY);   // owner_in == hash160(controllerSPK ‖ pool_id ‖ state_id)
  } else {
    pick(ownerTypeInAbs); e(B(OwnerType.KEY), O.OP_EQUALVERIFY); // KEY arm
    pick(pAbs); e(O.OP_HASH160); pick(ownerInAbs); e(O.OP_EQUALVERIFY); // key-auth: hash160(P) == backtrace-proven owner_in
  }
  for (let k = 0; k < depth; k++) ops.push(O.OP_DROP);        // CLEANSTACK
  ops.push(O.OP_1);
  return { ops, Wk, Wtotal };
}
export const buildSplitFullLineageV2Leaf = (Mp, j, M, N, consts) => bells.script.compile(splitFullLineageV2Ops(Mp, j, M, N, consts).ops);

// witness (deepest→top) for the v2 leaf. parent = the v2 kernel witness; outs = current children [{owner, value, amount, ownerType}].
import { splitParentV2Witness } from './p1e3SplitLineageV2.mjs';
import { limbNum, limbSer, amountLimbsN } from './amounts.mjs';
export function splitFullLineageV2Witness({ parent, epi, ownSPK, changeValue, outs, amountIn, N = 8 }) {
  const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
  const pairs = (v) => { const L = amountLimbsN(BigInt(v), N); const w = []; for (let i = 0; i < N; i++) w.push(limbNum(L[i]), limbSer(L[i])); return w; };
  const w = splitParentV2Witness(parent);
  w.push(epi.sig, epi.P, epi.c1, epi.c3, epi.c5, epi.c7, epi.c8, epi.c9, ownSPK, u64(changeValue));
  for (const o of outs) w.push(o.owner, u64(o.value), B(o.ownerType));  // owner_j, value_j, owner_type_j
  for (const o of outs) w.push(...pairs(o.amount));
  w.push(...pairs(amountIn));
  return w;
}
// SCRIPT-arm witness = the KEY witness ‖ the 4 controller fields (outpoint1, controllerSPK, pool_id, state_id) ABOVE it.
export function splitFullLineageV2ScriptWitness(args) {
  const { outpoint1, controllerSPK, poolId, stateId } = args.script;
  return [...splitFullLineageV2Witness(args), outpoint1, controllerSPK, poolId, stateId];
}
// BRICK 2 — append the 2 changeSPK witness fields (the CURRENT tx change, then the PARENT tx change) ABOVE the base witness (after
// the SCRIPT fields if any). Order matches the leaf abs layout cwBase = Wtotal + (SCRIPT?4:0). curChangeSpk/parChangeSpk are 34B SPKs.
export const withChangeWitness = (baseWitness, { curChangeSpk, parChangeSpk }) => [...baseWitness, curChangeSpk, parChangeSpk];
// the descriptor the SCRIPT note commits as owner: owner_in = hash160(controllerSPK(34) ‖ pool_id(32) ‖ state_id(32)).
export const scriptOwnerDescriptor = (controllerSPK, poolId, stateId) => bells.crypto.hash160(Buffer.concat([controllerSPK, poolId, stateId]));
