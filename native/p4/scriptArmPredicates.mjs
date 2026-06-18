// P4 SCRIPT-arm recognizer — attribute a CONTROLLER-AUTHORIZED spend of an owner_type=SCRIPT note (the DeFi enabler). The
// genesis-mirror extends to the SCRIPT arm via a consensus invariant the covenant ENFORCES for free: the input-count is BOUND
// to the owner_type. A KEY note can ONLY be spent through a KEY leaf, whose c2 = SHA256(outpoint0) is a 1-INPUT shaPrevouts; a
// SCRIPT note can ONLY be spent through a SCRIPT leaf, whose c2 = SHA256(outpoint0 ‖ outpoint1) is a 2-INPUT shaPrevouts. Neither
// c2 can equal the other's real sighash (the RED 1-input / RED 2-input scriptsim+consensus tests), and each leaf gates on
// owner_type_in, so a confirmed note-spend's vinCount is itself a consensus-PROVEN witness of the spent note's owner_type.
//
// The indexer MIRRORS this: it dispatches on the STORED note's owner_type, EXPECTS exactly that owner_type's input count, and
// HALTs covenant_escape (never silently ignores) if a known-live note appears spent in a structurally-impossible shape. The
// child reads are the state-v2 ABI UNCHANGED — the 4 controller fields (outpoint1, controllerSPK, pool_id, state_id) sit ABOVE
// the bottom-relative current-children offsets, so splitCandidatesFromWitnessStateV2 reads vin0's witness identically. We trust
// consensus on the AUTH (it enforced c4==controllerSPK@vin1 + owner_in==hash160(controllerSPK‖pool_id‖state_id) before the tx
// confirmed); we BIND what a witness could forge (amounts/owners) against the on-chain stateOut + Σ-conservation.
import * as bells from 'belcoinjs-lib';
import { isStateOut, isCovenantOut0, stateOutHash32 } from './predicates.mjs';
import { OwnerType } from '../wire.mjs';
import { splitDegree, splitCandidatesFromWitnessStateV2, splitCreditAmountsV2 } from './splitPredicates.mjs';

const H160 = bells.crypto.hash160;
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const realOutpoint = (input) => Buffer.concat([input.hash, u32le(input.index)]); // vin's prevout as serialized (txid_internal ‖ vout_le)

// BIND-not-DECLARE the SCRIPT AUTH (the indexer as a COMPLETE 2nd validator). The recognizer historically TRUSTED consensus on the
// auth (it enforced c4==controllerSPK@vin1 + owner_in==hash160(controllerSPK‖pool_id‖state_id) before the tx confirmed) and only
// BOUND the forgeable amounts/owners. This re-derives owner_in OFF-CHAIN from vin0's witness controller fields and verifies it ==
// the STORED note's owner — and that the witness-declared outpoint1 == the REAL vin1 outpoint — so the indexer no longer relies on
// "consensus enforced it" (the cardinal rule applied to the auth too). The 4 SCRIPT fields sit at the base Wtotal (just above the
// target limbs), BEFORE any changeWitness fields ⟹ this offset is changeWitness-independent. Fail-closed: a wrong size/offset ⟹ null.
function scriptControllerFromWitnessStateV2(tx, parentDegree, N) {
  if (!Number.isInteger(parentDegree) || parentDegree < 1) return null;
  const M = splitDegree(tx);
  const w = tx.ins[0].witness;
  const Wtotal = (3 + 4 * parentDegree) + 10 + 3 * M + 2 * M * N + 2 * N; // splitFullLineageV2Ops base witness length (state-v2 ABI)
  const outpoint1 = w[Wtotal], controllerSPK = w[Wtotal + 1], poolId = w[Wtotal + 2], stateId = w[Wtotal + 3];
  if (![outpoint1, controllerSPK, poolId, stateId].every(Buffer.isBuffer)) return null;
  if (outpoint1.length !== 36 || controllerSPK.length !== 34 || poolId.length !== 32 || stateId.length !== 32) return null;
  return { outpoint1, controllerSPK, poolId, stateId };
}
// owner_in descriptor = hash160(controllerSPK(34) ‖ pool_id(32) ‖ state_id(32)) — the SAME derivation as p1e3SplitFullLineageV2.scriptOwnerDescriptor.
const scriptOwnerIn = ({ controllerSPK, poolId, stateId }) => H160(Buffer.concat([controllerSPK, poolId, stateId]));

// consensus binds vinCount ↔ owner_type: KEY (1-input c2) ⟹ 1; SCRIPT (2-input c2) ⟹ 2. BURN is TERMINAL — no leaf spends a
// BURN note (there is no BURN arm; a BURN note is supply-removed at creation), so a BURN-note spend cannot be consensus-valid.
export function expectedInputCount(ownerType) {
  if (ownerType === OwnerType.KEY) return 1;
  if (ownerType === OwnerType.SCRIPT) return 2;
  return null; // BURN or unknown — no spend arm exists; spending it is a covenant_escape
}

// (SS1) isScriptSplitShape — the 2-INPUT split shape: vin0 spends the SCRIPT note, vin1 is the controller co-spend; the OUTPUTS
//       are the SAME interleaved split topology as the KEY split (tokenOut_j @2j, stateOut_j @2j+1, change @2M, a non-covenant
//       34B change). Identical to isSplitTransferShape except vinCount==2 (the fund-critical 34B-change mirror is preserved).
export function isScriptSplitShape(tx, transferSPK) {
  if (tx.ins.length !== 2) return false;
  const V = tx.outs.length;
  if (V < 5 || V > 9 || V % 2 === 0) return false;        // 2M+1 odd, M ∈ {2,3,4} (F-01: cap M_MAX=4 so the indexer accept-set == the covenant's)
  const M = (V - 1) / 2;
  for (let j = 0; j < M; j++) {
    if (!isCovenantOut0(tx.outs[2 * j], transferSPK)) return false;   // tokenOut_j (covenant, FULL 34B equals)
    if (!isStateOut(tx.outs[2 * j + 1])) return false;               // stateOut_j (value==0, 0x6a 0x20‖32B)
  }
  const change = tx.outs[2 * M];
  if (isCovenantOut0(change, transferSPK)) return false;              // change MUST NOT be a token note (RED-3b)
  if (Number(change.value) === 0 || change.script.length !== 34) return false; // 34B SPK mirror (else unspendable children)
  return true;
}

// (SS2) isScriptMonoTransferShape — the 2-INPUT SCRIPT 1→1 send-all shape: vin0 spends the SCRIPT note, vin1 is the controller
//       co-spend; the outputs are the SAME mono-transfer topology as the KEY 1→1 (out0=covenant, out1=stateOut, out2=change). A
//       SCRIPT note's send-all is 2-input (transferSendAllV2ScriptWitness), so isMonoInputTransferShape (vin==1) MISSES it — without
//       this a valid SCRIPT withdrawal FALSE-HALTs (covenant_escape) AND never enters the indexer fixpoint (the SWEEP false-HALTs).
export function isScriptMonoTransferShape(tx, transferSPK) {
  return tx.ins.length === 2 && tx.outs.length === 3 && isCovenantOut0(tx.outs[0], transferSPK) && isStateOut(tx.outs[1]);
}

// recognizeScriptSplit — attribute a controller-authorized SCRIPT-note split. Returns:
//   { children: [...] }      — the M BIND-credited children (each carries its owner_type), OR
//   { halt, reason }         — a covenant_escape: a known-live note spent in a shape that contradicts its consensus-bound
//                              owner_type (terminal BURN spend, or vinCount != the owner_type-bound count) — HALT, never ignore.
//   null                     — not the SCRIPT-split case (KEY note → use the 1-input recognizers; or an unbindable witness =
//                              FULL_IGNORE, which for a KNOWN-LIVE note the caller must escalate to its own covenant_escape HALT).
// `parentDegree` (M') MUST come from the STORED parent note's recorded split-degree, never the spend tx (splitPredicates contract).
export function recognizeScriptSplit(tx, transferSPK, spentNote, parentDegree, N = 8) {
  const expect = expectedInputCount(spentNote.ownerType);
  if (expect === null) return { halt: true, reason: `spend of a terminal/unknown owner_type ${spentNote.ownerType} note` };
  if (tx.ins.length !== expect) return { halt: true, reason: `vinCount ${tx.ins.length} contradicts owner_type-bound ${expect}` };
  if (spentNote.ownerType !== OwnerType.SCRIPT) return null;          // KEY note → routed to the existing 1-input recognizers
  if (!isScriptSplitShape(tx, transferSPK)) return null;
  // BIND-not-DECLARE the AUTH (2nd-validator, don't trust consensus): re-derive owner_in from the witness controller fields ==
  // stored owner, and the witness outpoint1 == the real vin1 outpoint. A known-live SCRIPT note whose witness contradicts its
  // committed descriptor/co-spend is a covenant_escape ⟹ HALT (never silent-ignore).
  const ctrl = scriptControllerFromWitnessStateV2(tx, parentDegree, N);
  if (!ctrl) return { halt: true, reason: 'SCRIPT split: controller fields unreadable from vin0 witness' };
  if (!scriptOwnerIn(ctrl).equals(spentNote.owner)) return { halt: true, reason: 'SCRIPT owner_in (hash160(controllerSPK‖pool_id‖state_id)) != stored note owner' };
  if (!ctrl.outpoint1.equals(realOutpoint(tx.ins[1]))) return { halt: true, reason: 'SCRIPT witness outpoint1 != real vin1 outpoint' };
  const cands = splitCandidatesFromWitnessStateV2(tx, parentDegree, N);
  if (!cands) return null;
  const children = splitCreditAmountsV2(tx, spentNote, cands);
  if (!children) return null;
  return { children };
}
