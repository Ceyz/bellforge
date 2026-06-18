// P4 SPLIT indexer predicates — recognize a divisible split (1 note → M child notes) and CREDIT each child BIND-not-DECLARE:
// every child amount is re-derived from the spend witness, VERIFIED against its on-chain stateOut hash, and Σ children ==
// the spent note's amount (the same conservation the covenant enforces). Mirrors splitFullOps' FROZEN interleaved topology
// (tokenOut_j @ vout 2j, stateOut_j @ vout 2j+1, change @ vout 2M, voutCount 2M+1) and witness ABI. The change is credited
// only if it is NOT a covenant SPK (RED-3b: a token-valued change would be an unbound (M+1)-th note = inflation).
import * as bells from 'belcoinjs-lib';
import { isStateOut, isCovenantOut0, stateOutHash32 } from './predicates.mjs';
import { encodeState, encodeStateV2, decodeAmount } from '../wire.mjs';

const S = bells.crypto.sha256;

// (S1) isSplitTransferShape — vin==1; vout==2M+1 (M>=2); tokenOut_j @2j == transferSPK; stateOut_j @2j+1 a valid stateOut;
//      the change @2M is NOT a covenant SPK (the RED-3b off-chain guard, paired with the covenant's changeSPK != ownSPK).
export function isSplitTransferShape(tx, transferSPK) {
  if (tx.ins.length !== 1) return false;
  const V = tx.outs.length;
  if (V < 5 || V > 9 || V % 2 === 0) return false;        // 2M+1 odd, M ∈ {2,3,4} (F-01: cap M_MAX=4 so the indexer accept-set == the covenant's; M>=5 is unbuildable on-chain)
  const M = (V - 1) / 2;
  for (let j = 0; j < M; j++) {
    if (!isCovenantOut0(tx.outs[2 * j], transferSPK)) return false;   // tokenOut_j (covenant, by FULL 34B equals)
    if (!isStateOut(tx.outs[2 * j + 1])) return false;               // stateOut_j (value==0, 0x6a 0x20‖32B)
  }
  const change = tx.outs[2 * M];
  if (isCovenantOut0(change, transferSPK)) return false;              // change MUST NOT be a token note (RED-3b)
  if (Number(change.value) === 0 || change.script.length !== 34) return false; // change = a 34B-SPK, non-zero-value output:
  //   FUND-CRITICAL mirror — the lineage-v2 child-spend reconstructs the parent INCLUDING its change as changeVal‖0x22‖SPK(34);
  //   a non-34B change SPK ⟹ permanently-unspendable children, so the indexer must not recognize such a split as creditable.
  return true;
}
export const splitDegree = (tx) => (tx.outs.length - 1) / 2;

// (S2) splitCandidatesFromWitness — read each child's CANDIDATE (amount, owner) from the spend witness. These are only
//      candidates: S3 BINDS each against the on-chain stateOut hash (SHA256(state)==stateOut_j.hash32), so a forged witness
//      value cannot be credited — the indexer never TRUSTS the witness, it verifies a preimage it cannot otherwise invert.
//      amount = the 8 b_ser limb bytes (LE) = amount_ser_j; owner = owner_j(20). N=8 limbs. tx.ins[0].witness =
//      [ ...W items..., leaf, controlBlock]; offsets below = the FROZEN ABI of `splitFullOps` (the mini split leaf).
//      ⚠ ABI COUPLING (GPT round-3): these offsets are tied to the ON-CHAIN split leaf's witness layout. The lineage-v2
//      position-aware leaf has a DIFFERENT witness ABI → when it ships, this read MUST be VERSION-GATED (dispatch on the
//      recognized leaf / an abiVersion arg) BEFORE reading slots, else a VALID v2 split is mis-read → a FALSE covenant_escape
//      HALT. Until then this assumes the splitFullOps ABI. (The spent note's OWN amount is NEVER read here — see S3.)
// the shared limb-read: given per-(output,limb) absolute witness offsets, read each child's (amount, owner). The reads are
// CANDIDATES only — S3 BINDs them against the on-chain stateOut hash, so wrong offsets fail-CLOSED (a mis-read yields a value
// that won't reproduce the stateOut ⟹ FULL_IGNORE/HALT, never a silent wrong credit).
function readCandidates(w, M, ownerAbs, serAbs, N) {
  const out = [];
  for (let j = 0; j < M; j++) {
    const owner = w[ownerAbs(j)];
    if (!Buffer.isBuffer(owner) || owner.length !== 20) return null;
    const ser = Buffer.alloc(N);
    for (let i = 0; i < N; i++) { const b = w[serAbs(j, i)]; if (!Buffer.isBuffer(b) || b.length !== 1) return null; ser[i] = b[0]; }
    let amount; try { amount = decodeAmount(ser); } catch { return null; }
    out.push({ amount, owner });
  }
  return out;
}

// ABI v1 — the `splitFullOps` mini split leaf. Witness (deepest→top): [owner_in, sig, P, c1,c3,c5,c7,c8,c9, outpoint, ownSPK,
// changeValue, (owner_j,value_j)_{M}, (out_num,out_ser)_{j,i}, (tgt_num,tgt_ser)_i]. owner_j @ 12+2j; b_ser base 12+2M.
export function splitCandidatesFromWitness(tx, N = 8) {
  const M = splitDegree(tx);
  const w = tx.ins[0].witness;                            // [w0..w_{W-1}, leaf, controlBlock]
  const base = 12 + 2 * M;
  return readCandidates(w, M, (j) => 12 + 2 * j, (j, i) => base + (j * N + i) * 2 + 1, N);
}

// ABI v2 — the POSITION-AWARE LINEAGE v2 leaf (`splitFullLineageOps`/`splitFullLineageGrandparentOps`). Its witness stacks the
// kernel (txP reconstruction, Wk = 3 + 3·M' items) at the BOTTOM, then the epilogue + current-split items; so the current
// children sit at Wk-relative offsets, NOT the v1 12-relative ones. (The grandparent variant APPENDS its txGP pieces ABOVE the
// whole splitFullLineageWitness, so these bottom offsets are identical for both the no-grandparent and grandparent leaves.)
//   witness (deepest→top): [ kernel(Wk) , sig,P,c1,c3,c5,c7,c8,c9, ownSPK, changeValue, (owner_j,value_j)_{M},
//                            (out_num,out_ser)_{j,i}, (tgt_num,tgt_ser)_i , <gp pieces if any> , leaf, controlBlock ]
//   owner_j @ Wk+10+2j ; b_ser base Wk+10+2M. `parentDegree` (M') comes from the indexed PARENT split tx (NOT the witness);
//   j is the spent note's vout/2. A v1 read of a v2 split returns the WRONG owners/amounts ⟹ S3 BIND fails ⟹ the caller HALTs
//   covenant_escape — exactly the FALSE HALT this version-gate exists to prevent (read v2 with the v2 ABI, never the v1 ABI).
//   🔴 CALLER CONTRACT (adversarial review 2026-06-14, consensus-lens [6] MEDIUM): `parentDegree` MUST be sourced from the STORED
//   parent note's own recorded split-degree (the degree under which ITS stateOut was BIND-credited at creation) — NEVER inferred
//   from the spending tx or its witness. BIND fail-closes a mis-CREDIT either way (preimage resistance), but a spender-influenced
//   M' could FALSE-HALT a VALID v2 split (a liveness DoS that halts the whole line). When the Indexer wires v2 dispatch in: record
//   `parentDegree` on each split-child note at credit time, pass it here, and add a RED proving a wrong caller-supplied M' HALTs a
//   genuinely-valid split (the split_v2_abi test only proves "wrong M' does not CREDIT", not "the indexer sources M' correctly").
export function splitCandidatesFromWitnessV2(tx, parentDegree, N = 8) {
  if (!Number.isInteger(parentDegree) || parentDegree < 2) return null;
  const M = splitDegree(tx);
  const w = tx.ins[0].witness;
  const Wk = 3 + 3 * parentDegree;
  const base = Wk + 10 + 2 * M;
  return readCandidates(w, M, (j) => Wk + 10 + 2 * j, (j, i) => base + (j * N + i) * 2 + 1, N);
}

// version dispatcher — the caller selects the ABI by the recognized leaf. v2 (lineage) MUST pass `parentDegree` (M' of the
// indexed parent split). Defaults to v1 (the mini split leaf) for back-compat with the existing P4 split tests.
export function splitCandidates(tx, { abiVersion = 'v1-mini', parentDegree, N = 8 } = {}) {
  if (abiVersion === 'state-v2') return splitCandidatesFromWitnessStateV2(tx, parentDegree, N);
  if (abiVersion === 'mono-genesis') return splitCandidatesFromWitnessMonoGenesis(tx, N);
  if (abiVersion === 'v2-lineage') return splitCandidatesFromWitnessV2(tx, parentDegree, N);
  if (abiVersion === 'v1-mini') return splitCandidatesFromWitness(tx, N);
  throw new Error(`unknown split witness ABI version: ${abiVersion}`);
}

// the shared state-v2 child read at an explicit Wk (the leaf's bottom witness count). Both v2 split-child (Wk=3+4·M') and the
// mono-genesis split-a-mono (Wk=4) use the SAME Wk-relative current-output layout: owner_j @ Wk+10+3j, value_j @ +1, owner_type_j
// @ +2; limb pairs at base = Wk+10+3M. A wrong Wk lands on the wrong slots ⟹ wrong/non-20B owner ⟹ null ⟹ S3 BIND fail-closed.
function readStateV2CandidatesAtWk(tx, Wk, N) {
  const M = splitDegree(tx);
  const w = tx.ins[0].witness;
  const ownerAbs = (j) => Wk + 10 + 3 * j, ownerTypeAbs = (j) => Wk + 10 + 3 * j + 2;
  const base = Wk + 10 + 3 * M;
  const serAbs = (j, i) => base + (j * N + i) * 2 + 1;
  const out = [];
  for (let j = 0; j < M; j++) {
    const owner = w[ownerAbs(j)], otBuf = w[ownerTypeAbs(j)];
    if (!Buffer.isBuffer(owner) || owner.length !== 20) return null;
    if (!Buffer.isBuffer(otBuf) || otBuf.length !== 1) return null;
    const ser = Buffer.alloc(N);
    for (let i = 0; i < N; i++) { const b = w[serAbs(j, i)]; if (!Buffer.isBuffer(b) || b.length !== 1) return null; ser[i] = b[0]; }
    let amount; try { amount = decodeAmount(ser); } catch { return null; }
    out.push({ amount, owner, ownerType: otBuf[0] });
  }
  return out;
}

// ABI STATE-v2 — the TIER-FULL split-child leaf (`splitFullLineageV2Ops`): the v2-state kernel has 4 fields per parent output
// (Wk = 3 + 4·M'). Caller MUST source parentDegree (M') from the STORED parent note (never the spend tx) — see the contract above.
export function splitCandidatesFromWitnessStateV2(tx, parentDegree, N = 8) {
  if (!Number.isInteger(parentDegree) || parentDegree < 1) return null; // parentDegree=1 = the TRANSFER-parent base case (Wk=3+4·1=7)
  return readStateV2CandidatesAtWk(tx, 3 + 4 * parentDegree, N);
}

// ABI MONO-GENESIS — the split-a-mono leaf (`splitAMonoV2Ops`, native/p1e3MonoGenesisV2.mjs): its kernel reconstructs the GENESIS
// mint (not a split parent), so the bottom witness is exactly 4 fields [genesisTxid, mintOutpoint, changeValGp, changeSPKgp] ⟹
// Wk=4 (no parentDegree). The dispatcher MUST select this by the spent note's provenance=='genesis' (the mint note), NEVER by
// guessing M' (3+4·M'==4 has no integer solution, so the state-v2 reader cannot accidentally read a mono-genesis split).
export function splitCandidatesFromWitnessMonoGenesis(tx, N = 8) {
  return readStateV2CandidatesAtWk(tx, 4, N);
}
// the MERGE-PARENT ABI — a merged note's immediate parent is a 2-input/3-output merge tx ⟹ the spend leaf uses the merge kernel (Wk=8).
// Selected by the spent note's provenance=='merge' (8 has no 3+4·M' integer solution, so the state-v2 reader cannot cross-read it).
export function splitCandidatesFromWitnessMerge(tx, N = 8) {
  return readStateV2CandidatesAtWk(tx, 8, N);
}

// (S3 v2) splitCreditAmountsV2 — BIND each candidate (amount_j, owner_j, owner_type_j) to its on-chain v2 stateOut (66B preimage)
// AND Σ == spent.amount. The genesis-mirror: the indexer credits a v2 split's M children IFF the v2 covenant would accept it.
// owner_type is carried onto each credited child (so the live-note set + the digest distinguish key/script/burn supply).
export function splitCreditAmountsV2(tx, spentNote, candidates) {
  const M = splitDegree(tx);
  if (!Array.isArray(candidates) || candidates.length !== M) return null;
  let sigma = 0n; const children = [];
  for (let j = 0; j < M; j++) {
    const { amount, owner, ownerType } = candidates[j];
    if (typeof amount !== 'bigint' || !Buffer.isBuffer(owner) || owner.length !== 20) return null;
    if (!(ownerType === 0 || ownerType === 1 || ownerType === 2)) return null;
    let reproduced; try { reproduced = S(encodeStateV2({ ownerType, tokenId: spentNote.tokenId, amount, owner })); } catch { return null; }
    if (!reproduced.equals(stateOutHash32(tx.outs[2 * j + 1]))) return null;       // BIND each child to its v2 stateOut
    sigma += amount;
    children.push({ tokenId: spentNote.tokenId, amount, owner: Buffer.from(owner), ownerType, vout: 2 * j });
  }
  if (sigma !== spentNote.amount) return null;                                       // conservation BIND: Σ == spent.amount
  return children;
}

// (S3) splitCreditAmounts — BIND: each candidate (amount_j, owner_j) MUST reproduce its on-chain stateOut hash, AND
//      Σ amount_j == the spent note's amount. Returns the M child notes {tokenId, amount, owner, vout} or null (FULL_IGNORE).
//      🔑 GENESIS-MIRROR (GPT round-3): `spentNote` is the indexer's GENESIS-FORWARD live note (keyed by its outpoint =
//      parent txid ‖ real vout 2j), whose `.amount` was itself BIND-established against ITS parent's stateOut when it was
//      created (mint→AMOUNT_0; transfer→spent.amount; split-child→a stateOut-verified candidate). So `spentNote.amount` IS the
//      parent-committed amount at the note's real position — the OFF-CHAIN MIRROR of the lineage-v2 leaf's c2-carries-position
//      backtrace of amount_in. It is NEVER taken from the spend witness. ⟹ a forged input amount cannot pass: Σ children must
//      equal the indexer's backtrace-established `spentNote.amount`, else the caller HALTs covenant_escape (a known-live note
//      spent in an unbindable split = an N9/P4 contradiction). The genesis-mirror holds once the ON-CHAIN leaf also
//      backtraces amount_in (lineage v2); the mini `splitFullOps` (free-witness amount_in) is parent-forgeable on-chain and the
//      indexer's HALT is the safety-net catching that until lineage v2 lands.
export function splitCreditAmounts(tx, spentNote, candidates) {
  const M = splitDegree(tx);
  if (!Array.isArray(candidates) || candidates.length !== M) return null;
  let sigma = 0n;
  const children = [];
  for (let j = 0; j < M; j++) {
    const { amount, owner } = candidates[j];
    if (typeof amount !== 'bigint' || !Buffer.isBuffer(owner) || owner.length !== 20) return null;
    const reproduced = S(encodeState({ tokenId: spentNote.tokenId, amount, owner }));
    if (!reproduced.equals(stateOutHash32(tx.outs[2 * j + 1]))) return null;            // BIND each child to its stateOut
    sigma += amount;
    children.push({ tokenId: spentNote.tokenId, amount, owner: Buffer.from(owner), vout: 2 * j });
  }
  if (sigma !== spentNote.amount) return null;                                          // conservation BIND: Σ == spent.amount
  return children;
}
