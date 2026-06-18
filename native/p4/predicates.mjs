// P4 STEP 0 — the FROZEN predicate functions: the ONE source of truth every indexer component (and the 2nd validator)
// imports, so the recognizers CANNOT drift (closes the genesis-divergence / decoy / declare-not-bind / nondeterminism
// "three-ways" holes from the p4-indexer-design adversarial workflow). All bytes mirror the on-chain covenant + wire.mjs.
// Txs are parsed as belcoinjs Transaction objects (from a confirmed block). amounts (token) are bigint; sat values Number.
import * as bells from 'belcoinjs-lib';
import { u64, u32, varslice } from '../sighashParts.mjs';
import { encodeState, encodeStateV2 } from '../wire.mjs';
import { HDR_G, genMid, FRAME, LOCKTIME0 } from '../p1e3Const.mjs';

const S = bells.crypto.sha256;
const hash256 = (b) => S(S(b));

// internalTxid = hash256(LEGACY/witness-stripped serialization) = the SORT KEY + token_id source. getId() strips witness.
export const internalTxid = (tx) => Buffer.from(tx.getId(), 'hex').reverse();
// the 36-byte outpoint of vin[k], byte-identical to the covenant's outpoint (internalTxid ‖ u32le(vout)).
export const vinOutpoint = (tx, k) => Buffer.concat([tx.ins[k].hash, u32(tx.ins[k].index)]);

// (1) isStateOut — the ONLY legal stateOut test: value==0 AND script == 0x6a 0x20 ‖ <32B hash> (34 script bytes).
//     NEVER pattern-match loosely / scan for an OP_RETURN; the serialized form is FRAME ‖ hash32 = 43B.
export function isStateOut(out) {
  return Number(out.value) === 0 && out.script.length === 34 && out.script[0] === 0x6a && out.script[1] === 0x20;
}
export const stateOutHash32 = (out) => out.script.subarray(2, 34);

// (2) isCovenantOut0 — FULL 34-byte Buffer.equals to the precomputed transferSPK (never a 0x5120 prefix/shape match).
export const isCovenantOut0 = (out, transferSPK) => Buffer.isBuffer(out.script) && out.script.equals(transferSPK);

// (3) reconstructGenesisTxBytes — rebuild the EXACT bytes the covenant's genesis arm hashes (p1e3GenesisReconstructOps).
//     deploy = { G(36), VALUE_0(bigint), transferSPK(34), stateOut0(43), feeOut(Buffer), changeSpkLen(34) }.
export function reconstructGenesisTxBytes(tx, deploy) {
  const M_outpoint = vinOutpoint(tx, 0);                        // vin0 = M (free; mirrors the covenant's witness M)
  const out3 = tx.outs[3];
  const tokenNote0 = Buffer.concat([u64(deploy.VALUE_0), varslice(deploy.transferSPK)]); // VALUE_0 ‖ 0x22 ‖ transferSPK
  const changeOut = Buffer.concat([u64(out3.value), varslice(out3.script)]);             // val ‖ 0x22 ‖ out3.spk
  return Buffer.concat([HDR_G, M_outpoint, genMid(deploy.G), tokenNote0, deploy.stateOut0, deploy.feeOut, changeOut, LOCKTIME0]);
}

// (4) isGenesisTemplate — genesis iff the SAME hash256 check the covenant performs (NOT an output-by-output spot check).
//     ⟹ P4 accepts a genesis note IFF the N9 covenant's genesis arm would accept its first transfer (by construction).
export function isGenesisTemplate(tx, deploy) {
  if (tx.ins.length !== 2 || tx.outs.length !== 4) return false;
  if (!vinOutpoint(tx, 1).equals(deploy.G)) return false;                            // G consumed AT vin1 (mirrors genMid; the hash also enforces it — explicit per GPT P4 round-11 #5)
  if (tx.outs[3].script.length !== deploy.changeSpkLen) return false;               // change SHAPE pinned (covenant sizePin(34))
  return hash256(reconstructGenesisTxBytes(tx, deploy)).equals(internalTxid(tx));
}

// (5) isMonoInputTransferShape — vin==1, vout==3, out0=covenant, out1=stateOut (read out1 BY POSITION, never content-scan).
export function isMonoInputTransferShape(tx, transferSPK) {
  return tx.ins.length === 1 && tx.outs.length === 3 && isCovenantOut0(tx.outs[0], transferSPK) && isStateOut(tx.outs[1]);
}

// (6) creditAmount — BIND, not DECLARE: the credited token amount is the SPENT note's amount, full stop. No other source.
//     (The "find (amount,owner) s.t. SHA256==hash" framing is BANNED — it is the CAT20 mental model.)
export const creditAmount = (spentNote) => spentNote.amount;

// (7) verifyOwnerCandidate — owner is the ONLY free field: the on-chain out1 commitment must reproduce from the BOUND
//     amount + the candidate owner. Returns true iff SHA256(encodeState({G, amount=creditAmount, owner})) == out1.hash32.
export function verifyOwnerCandidate(out1Hash32, G, boundAmount, ownerCandidate) {
  if (!Buffer.isBuffer(ownerCandidate) || ownerCandidate.length !== 20) return false;
  return S(encodeState({ tokenId: G, amount: boundAmount, owner: ownerCandidate })).equals(out1Hash32);
}

// helper for the deploy descriptor's derived consts (deploy.mjs will own loading/validation; this derives the bytes)
export function deriveStateOut0({ tokenId, AMOUNT_0, OWNER_0 }) {
  return Buffer.concat([FRAME, S(encodeState({ tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
}

// ====================================================================================================================
// --- v2 BIND (P2-0 BRICK 0, the TIER-FULL ledger) — the on-chain stateOut now commits encodeStateV2 (66B, owner_type IN the
//     hash). The off-chain BIND MUST reproduce the SAME 66B preimage, else the indexer false-rejects EVERY v2 note (the critic's
//     CRITICAL "indexer wired to v1" trap). owner_type joins amount/owner as a re-derived-and-verified field (still no DECLARE:
//     the candidate (ownerType, owner) must reproduce the on-chain hash; only then is the note credited).
export function verifyOwnerCandidateV2(out1Hash32, G, boundAmount, ownerType, ownerCandidate) {
  if (!Buffer.isBuffer(ownerCandidate) || ownerCandidate.length !== 20) return false;
  if (!(ownerType === 0x00 || ownerType === 0x01 || ownerType === 0x02)) return false;
  try { return S(encodeStateV2({ ownerType, tokenId: G, amount: boundAmount, owner: ownerCandidate })).equals(out1Hash32); }
  catch { return false; }
}
export function deriveStateOut0V2({ tokenId, AMOUNT_0, OWNER_0, ownerType = 0x00 }) {
  return Buffer.concat([FRAME, S(encodeStateV2({ ownerType, tokenId, amount: AMOUNT_0, owner: OWNER_0 }))]);
}

// (8) sendAllCandidateV2 — the 1→1 SEND-ALL v2 owner/owner_type read. The transferSendAllV2Ops witness places owner_out @ Wk+10 and
//     owner_type_out @ Wk+12 (native/p1e3TransferV2.mjs:27, ownerOutAbs/ownerTypeOutAbs; the SCRIPT arm's 4 controller fields sit
//     ABOVE Wtotal so these bottom-relative reads are unchanged). Wk is selected by the SPENT note's provenance (genesis⟹4,
//     split/transfer⟹3+4·M'). Fail-CLOSED (null) on a missing/wrong-length/out-of-range field — for a KNOWN-LIVE spend the caller
//     escalates null to a covenant_escape HALT, never a silent leave-live. (The v1 fixed idx-10 read is WRONG for v2: it ignores Wk
//     AND owner_type — DO NOT use OUT_OWNER_WITNESS_IDX for a v2 ledger.) Returns { owner(20B), ownerType ∈{0,1,2} } or null.
export function sendAllCandidateV2(tx, Wk) {
  if (!Number.isInteger(Wk) || Wk < 4) return null;
  const w = tx.ins[0] && tx.ins[0].witness;
  if (!Array.isArray(w)) return null;
  const owner = w[Wk + 10], otBuf = w[Wk + 12];
  if (!Buffer.isBuffer(owner) || owner.length !== 20) return null;
  if (!Buffer.isBuffer(otBuf) || otBuf.length !== 1) return null;
  const ownerType = otBuf[0];
  if (!(ownerType === 0x00 || ownerType === 0x01 || ownerType === 0x02)) return null;
  return { owner: Buffer.from(owner), ownerType };
}
