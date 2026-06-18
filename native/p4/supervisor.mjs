// P4d — the SUPERVISOR + 2nd VALIDATOR. V2 is an INDEPENDENT re-derivation (a different code path from the incremental V1)
// that MUST byte-agree on {state-root, note-set digest}; any divergence ⟹ HALT-THE-LINE (the CAT20 "nobody compared" gap).
// Attestation is REVOCABLE-BY-DESIGN: P4 signs the root of a block buried ≥ CONFIRM_DEPTH below the tip with an EXPLICIT
// finality assumption ("final under ≤CONFIRM_DEPTH reorg") — because Bellscoin enforces NO consensus finality (probed). A
// deeper reorg triggers a documented retract-and-republish, never a silent broken promise.
import { indexChain, CONFIRM_DEPTH } from './indexer.mjs';
import { replayInvariant } from './replay.mjs';

// The per-height comparison tuple a 2nd validator must reproduce. PRODUCTION-V2 CONTRACT (GPT P4 round-11 #3): the test V2
// below is a same-runtime reindex (it catches incremental-vs-reindex corruption, NOT a SHARED recognizer bug). A real V2 is
// a SEPARATE RUNTIME (other language, other tx/witness/txid parser, other hashing + state machine) fed ONLY by the frozen
// byte-vectors + the same descriptor hash, and it must emit this exact tuple at every height. Diff the tuples (and the
// per-tx `decisions` trace) by height: a mismatch localizes the divergence to one block + tells you WHICH tx disagreed
// (an explanation diff, not just a final-root diff — avoids opaque false HALTs).
export function heightTuple(ix) {
  return ix.records.map((r) => ({ height: r.height, blockhash: r.blockhash, root: r.rootAfter.toString('hex'), decisions: r.decisions || [] }));
}

// Byte-agreement between V1 (incremental) and a V2 re-derivation, PER HEIGHT (not just the final root) so a divergence is
// pinned to the exact block, plus the final note-set digest, mintCount and supply.
export function crossValidate(v1, deploy, allBlocks) {
  const v2 = indexChain(deploy, allBlocks);
  const t1 = heightTuple(v1), t2 = heightTuple(v2);
  if (t1.length !== t2.length) throw new Error(`HALT: V1/V2 record-count divergence (${t1.length} vs ${t2.length})`);
  for (let i = 0; i < t1.length; i++) {
    if (t1[i].root !== t2[i].root || t1[i].blockhash !== t2[i].blockhash)
      throw new Error(`HALT: V1/V2 divergence at height ${t1[i].height} (root/blockhash) — diff the per-tx decisions trace`);
  }
  if (!v1.noteSetDigest().equals(v2.noteSetDigest())) throw new Error('HALT: V1/V2 note-set digest divergence');
  if (v1.mintCount !== v2.mintCount) throw new Error(`HALT: V1/V2 mintCount divergence (${v1.mintCount} vs ${v2.mintCount})`);
  if ((v1.burnedSupply || 0n) !== (v2.burnedSupply || 0n)) throw new Error(`HALT: V1/V2 burnedSupply divergence (${v1.burnedSupply} vs ${v2.burnedSupply})`); // v2 TIER-FULL (digest folds it too; explicit for localization)
  replayInvariant(v1); replayInvariant(v2);
  return { agreed: true, root: Buffer.from(v1.root), heights: t1.length };
}

// The set of REVOCABLE attestations: every block buried ≥ confirmDepth below the tip. The finality is stated, not assumed.
export function attestations(ix, { confirmDepth = CONFIRM_DEPTH } = {}) {
  const tipH = ix.tip ? ix.tip.height : -1;
  return ix.records
    .filter((r) => tipH - r.height >= confirmDepth)
    .map((r) => ({ height: r.height, blockhash: r.blockhash, root: Buffer.from(r.rootAfter), finalUnder: `<=${confirmDepth}-block reorg` }));
}

// On a reorg that retracts an already-attested block, produce the retract-and-republish record (both roots provable from undo).
export function retraction(supersededAttestation, newRoot, newBlockhash) {
  return { retracts: supersededAttestation, replacedBy: { blockhash: newBlockhash, root: Buffer.from(newRoot) }, reason: 'reorg deeper than CONFIRM_DEPTH retracted an attested root' };
}
