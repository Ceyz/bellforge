// P4 MERGE recognizer (brick 6) — the off-chain dispatch for a K=2 merge. A merge is the ONE case where a KEY note appears in a
// 2-input tx (KEY notes are otherwise consensus-bound to 1 input), so the indexer dispatches on the STORED owner_type of vin0 (NEVER
// the tx shape — isMergeShape and isScriptMonoTransferShape are byte-identical at vin=2/vout=3). BIND-not-DECLARE: the merged note's
// amount = vin0.amount + vin1.amount from the STORED live notes, never the spend witness; verified against the output stateOut.
import * as bells from 'belcoinjs-lib';
import { OwnerType, encodeStateV2 } from '../wire.mjs';
import { stateOutHash32, verifyOwnerCandidateV2, isStateOut } from './predicates.mjs';

// owner_out lives at ownerOutAbs = 2·Wk+9 (Wk=7) in the merge leaf BODY witness (below the changeWitness fields) — the merged note's owner.
export const MERGE_OWNER_OUT_IDX = 23;

// a MERGE tx: exactly 2 covenant-note inputs, 3 outputs (tokenOut0@0 = P2TR transferSPK, stateOut0@1 = OP_RETURN, change@2 = a 34B
// NON-covenant SPK). Shape is necessary-but-not-sufficient — the indexer ALSO requires vin0 + vin1 to be STORED live KEY notes.
export function isMergeShape(tx, transferSPK) {
  if (tx.ins.length !== 2 || tx.outs.length !== 3) return false;
  if (Number(tx.outs[0].value) === 0 || !tx.outs[0].script.equals(transferSPK)) return false;  // tokenOut0 = the merged covenant note (value>0)
  if (!isStateOut(tx.outs[1])) return false;                           // stateOut0 = a CANONICAL OP_RETURN state (value==0, 34B) — NOT just any OP_RETURN
  const ch = tx.outs[2].script;
  if (ch.length !== 34 || ch.equals(transferSPK)) return false;        // change = a 34B non-covenant SPK (≠ a token note)
  return true;
}

// BIND the merged note. amount = vin0.amount + vin1.amount (STORED, never witness); owner self-sourced from the spend witness;
// owner_type = KEY (the leaf hard-pins owner_type_out==KEY). Returns { amount, owner, ownerType } or null (⟹ the caller HALTs).
export function mergeCreditAmount(tx, G, vin0Note, vin1Note) {
  const amount = vin0Note.amount + vin1Note.amount;                    // the conserved merge sum, from the stored notes
  const owner = tx.ins[0].witness && tx.ins[0].witness[MERGE_OWNER_OUT_IDX];
  if (!Buffer.isBuffer(owner) || owner.length !== 20) return null;     // witness-source availability (fail-closed)
  if (!verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount, OwnerType.KEY, owner)) return null;
  return { amount, owner: Buffer.from(owner), ownerType: OwnerType.KEY };
}
