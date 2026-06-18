// P4a + P4b + P4c — the deterministic, REORG-SAFE indexer core. Recognize token txs (genesis|transfer|skip|full_ignore),
// apply BIND-not-DECLARE (amount = spent note amount; owner self-sourced from the spend witness + verified against out1),
// emit canonical 101B events, fold the byte-identical state-root, and track per-block undo deltas so a reorg rolls back
// ATOMICALLY (fully purging branch-A notes before re-apply — closes the same-outpoint re-creation CRITICAL) and re-applies
// the new branch. REORG_HORIZON=1440 (probed): beyond it, HALT for a forced full reindex (never silently wrong; P4 is
// always reindex-from-genesis capable). The 2nd validator (P4d) re-derives + must byte-agree; P4e checks Σ live == AMOUNT_0.
import * as bells from 'belcoinjs-lib';
import { encodeEvent, EventType, canonicalSort, foldEvent, ZERO_ROOT } from '../wire.mjs';
import { encodeEventV2, EventTypeV2, canonicalSortV2, foldEventV2, ZERO_ROOT_V2, RULESET_TAG_V2, OwnerType, TOKEN_VALUE_MIN } from '../wire.mjs';
import { u32 } from '../sighashParts.mjs';
import { isGenesisTemplate, isMonoInputTransferShape, stateOutHash32, internalTxid, vinOutpoint, creditAmount, verifyOwnerCandidate, verifyOwnerCandidateV2, sendAllCandidateV2 } from './predicates.mjs';
import { isSplitTransferShape, splitDegree, splitCandidatesFromWitness, splitCreditAmounts, splitCandidatesFromWitnessStateV2, splitCandidatesFromWitnessMonoGenesis, splitCandidatesFromWitnessMerge, splitCreditAmountsV2 } from './splitPredicates.mjs';
import { expectedInputCount, isScriptSplitShape, isScriptMonoTransferShape, recognizeScriptSplit } from './scriptArmPredicates.mjs';
import { isMergeShape, mergeCreditAmount } from './mergePredicates.mjs';

const OUT_OWNER_WITNESS_IDX = 10; // out_owner in the N9 leaf witness layout (idx 0..15) — self-sourced, not declared
export const REORG_HORIZON = 1440; // ~24h @ 60s; undo retention before forced full reindex (probed; CAT20's 120 is UNSAFE here)
export const CONFIRM_DEPTH = 144;  // ~2.4h; default attestation-sign depth (probed; Bellscoin has NO consensus finality)
export const DEEP_CONFIRM_DEPTH = 288; // ~4.8h; HIGH-VALUE tier (GPT P4 round-11 #3) — pass as attestations(ix,{confirmDepth: DEEP_CONFIRM_DEPTH}).
                                       // Still a REVOCABLE economic policy, NOT finality (the chain provides none) — a deeper reorg always retracts.
const okey = (txidInternal, vout) => Buffer.concat([txidInternal, u32(vout)]).toString('hex');

export class Indexer {
  constructor(deploy, { reorgHorizon = REORG_HORIZON } = {}) {
    this.deploy = deploy;
    this.v2 = deploy.wireVersion === 'v2';    // TIER-FULL: owner_type, the genesis-rooted/SCRIPT/burn families, v2 events + digest
    this.liveNotes = new Map();              // outpointKey(hex) -> { tokenId, amount, owner, satValue, originHeight, [ownerType, provenance, parentDegree] }
    this.root = Buffer.from(this.v2 ? ZERO_ROOT_V2 : ZERO_ROOT);  // domain-seeded per wire version (a 32-zero seed lets v1/v2 collide)
    this.mintCount = 0;                       // genesis mints seen (must end == 1)
    this.burnedSupply = 0n;                   // v2: Σ of every credited BURN child (terminal, NEVER live); Σ(live)+burnedSupply==AMOUNT_0
    this.records = [];                        // per-block: { height, blockhash, prevhash, rootBefore, rootAfter, delta:{created,removed,burned}, sortedEvents }
    this.reorgHorizon = reorgHorizon;
  }
  get tip() { return this.records.length ? this.records[this.records.length - 1] : null; }
  // audit G: live notes the public serving layer must NOT present as freely spendable (sub-dust tokenOut ⇒ relay-stranded;
  // KEY notes are 1-input ⇒ no fee top-up). They remain counted for conservation (Σlive+burned==AMOUNT_0); they are flagged.
  strandedNotes() { return [...this.liveNotes.entries()].filter(([, n]) => n.stranded).map(([key, n]) => ({ key, ...n })); }

  // apply ONE tx; returns { event, created:key|null, removed:{key,prevValue}|null, decision }. Mutates liveNotes.
  applyTx(tx, height) {
    if (this.v2) return this.applyTxV2(tx, height);
    const G = this.deploy.G;
    if (isGenesisTemplate(tx, this.deploy)) {
      const txid = internalTxid(tx), key = okey(txid, 0);
      const note = { tokenId: G, amount: this.deploy.AMOUNT_0, owner: this.deploy.OWNER_0, satValue: Number(tx.outs[0].value), originHeight: height };
      this.liveNotes.set(key, note); this.mintCount++;
      return { event: encodeEvent({ type: EventType.MINT, tokenId: G, txidInternal: txid, vout: 0, amount: note.amount, owner: note.owner }), created: key, removed: null, decision: 'mint' };
    }
    if (isMonoInputTransferShape(tx, this.deploy.transferSPK)) {
      const spentKey = vinOutpoint(tx, 0).toString('hex');
      const spent = this.liveNotes.get(spentKey);
      // SKIP: vin0 is not a KNOWN-LIVE note (off-lineage / an unrelated pay-INTO-the-covenant UTXO with no ancestry to
      // genesis). Mirrors the on-chain depth-2 induction: a note is credited ONLY if it descends from a live note. NOT a HALT.
      if (!spent) return { event: null, created: null, removed: null, decision: 'skip-unlineaged' };
      // A KNOWN-LIVE note is being spent in a confirmed block ⟹ the N9 covenant ACCEPTED this spend ⟹ it MUST reproduce
      // as a valid transfer. BIND amount=spent.amount; owner self-sourced from the spend witness (idx 10); re-verify vs out1.
      const amount = creditAmount(spent);                                             // BIND (never declared)
      const owner = tx.ins[0].witness && tx.ins[0].witness[OUT_OWNER_WITNESS_IDX];     // self-sourced (idx 10)
      // covenant_escape (GPT P4 round-11, the load-bearing fix): a live note spent on-chain that P4 CANNOT bind is an
      // N9/P4 CONTRADICTION (the covenant rejects every unbindable spend pre-confirmation, so this can only be a P4
      // predicate bug or a consensus break) — NEVER a silent FULL_IGNORE that leaves the spent note live. HALT-and-alarm.
      // This also closes the witness-source-availability hole (idx10 absent/short on a known-live spend ⟹ HALT, not live).
      if (!verifyOwnerCandidate(stateOutHash32(tx.outs[1]), G, amount, owner))
        throw new Error(`HALT covenant_escape: live note ${spentKey} spent on-chain @${height} but out1/owner do not bind — the covenant accepted a spend P4 cannot reproduce (N9/P4 contradiction; full reindex / external audit)`);
      const txid = internalTxid(tx), key = okey(txid, 0);
      this.liveNotes.delete(spentKey);
      const note = { tokenId: G, amount, owner: Buffer.from(owner), satValue: Number(tx.outs[0].value), originHeight: height };
      this.liveNotes.set(key, note);
      return { event: encodeEvent({ type: EventType.TRANSFER, tokenId: G, txidInternal: txid, vout: 0, amount, owner }), created: key, removed: { key: spentKey, prevValue: spent }, decision: 'transfer' };
    }
    if (isSplitTransferShape(tx, this.deploy.transferSPK)) {
      const spentKey = vinOutpoint(tx, 0).toString('hex');
      const spent = this.liveNotes.get(spentKey);
      if (!spent) return { event: null, created: null, removed: null, decision: 'skip-unlineaged' };   // not a known-live note
      // A KNOWN-LIVE note split on-chain ⟹ the covenant accepted it ⟹ P4 MUST credit the M children (BIND each to its
      // stateOut + Σ == spent.amount), else covenant_escape HALT (never leave the really-spent note live).
      const cands = splitCandidatesFromWitness(tx);
      const children = cands && splitCreditAmounts(tx, spent, cands);
      if (!children)
        throw new Error(`HALT covenant_escape: live note ${spentKey} split on-chain @${height} but the children do not bind (Σ≠spent or a stateOut mismatch; N9/P4 contradiction)`);
      this.liveNotes.delete(spentKey);
      const txid = internalTxid(tx), events = [], created = [];
      for (const c of children) {
        const key = okey(txid, c.vout);
        this.liveNotes.set(key, { tokenId: G, amount: c.amount, owner: Buffer.from(c.owner), satValue: Number(tx.outs[c.vout].value), originHeight: height });
        created.push(key);
        events.push(encodeEvent({ type: EventType.TRANSFER, tokenId: G, txidInternal: txid, vout: c.vout, amount: c.amount, owner: c.owner }));
      }
      return { events, created, removed: [{ key: spentKey, prevValue: spent }], decision: 'split' };
    }
    return { event: null, created: null, removed: null, decision: 'skip-nontoken' };   // SKIP: not a genesis / transfer / split shape
  }

  // ===== v2 (TIER-FULL) dispatch — provenance-keyed (NEVER tx-shape-keyed) per the applytx-v2-design synthesis. Routes every spend
  //       to the right witness ABI (genesis⟹Wk=4, split/transfer⟹Wk=3+4·M') + arm (KEY 1-input / SCRIPT 2-input) by the STORED note.
  applyTxV2(tx, height) {
    const G = this.deploy.G, transferSPK = this.deploy.transferSPK;
    // [0] GENESIS — v2-66B mint (KEY-owned by OWNER_0). REQUIRES deploy.stateOut0 == deriveStateOut0V2, else isGenesisTemplate is false.
    if (isGenesisTemplate(tx, this.deploy)) {
      const txid = internalTxid(tx), key = okey(txid, 0);
      const note = { tokenId: G, amount: this.deploy.AMOUNT_0, owner: Buffer.from(this.deploy.OWNER_0), ownerType: OwnerType.KEY, provenance: 'genesis', parentDegree: null, satValue: Number(tx.outs[0].value), originHeight: height };
      this.liveNotes.set(key, note); this.mintCount++;
      return { events: [encodeEventV2({ type: EventTypeV2.MINT, ownerType: OwnerType.KEY, tokenId: G, txidInternal: txid, vout: 0, amount: note.amount, owner: note.owner })], created: [key], removed: [], burned: 0n, decision: 'mint' };
    }
    // [SPEND PRELUDE] — MULTI-INPUT-AWARE (brick 6): dispatch on the STORED owner_type of vin0, look up vin1 too when 2-input.
    const spentKey = vinOutpoint(tx, 0).toString('hex');
    const spent = this.liveNotes.get(spentKey);
    if (!spent) return { events: [], created: [], removed: [], burned: 0n, decision: 'skip-unlineaged' }; // [1] off-lineage pay-INTO — NOT a HALT
    const txid = internalTxid(tx);
    // [MERGE] a live KEY note in a 2-input tx = a K=2 MERGE (KEY is otherwise consensus-bound to 1 input ⟹ a 2-input KEY spend can ONLY
    //   be a merge). This MUST run BEFORE the arm gate (which would HALT it). The fixpoint only dispatches a merge once BOTH inputs are
    //   live, so vin1 should be a stored live KEY note here; otherwise it is a contradiction ⟹ HALT.
    if (spent.ownerType === OwnerType.KEY && tx.ins.length === 2) {
      const vin1Key = vinOutpoint(tx, 1).toString('hex');
      const vin1Note = this.liveNotes.get(vin1Key);
      // GENESIS-MIRROR (P4 must accept iff the leaf accepts — the CAT20 lesson): the merge leaf is TIGHT-CAP — both inputs are
      // transfer-notes (Mp=1 ⟹ provenance='transfer') at vout0, and owner_out==owner_in_self==owner_in_other (one owner). P4 must
      // enforce EXACTLY that, else it over-credits merges the chain would reject (a confirmed tight-cap merge satisfies all of these).
      if (!vin1Note || vin1Note.ownerType !== OwnerType.KEY || !isMergeShape(tx, transferSPK)
        || tx.ins[0].index !== 0 || tx.ins[1].index !== 0                                  // both inputs spent at vout0 (the leaf bakes VOUT0_LE for both)
        || spent.provenance !== 'transfer' || vin1Note.provenance !== 'transfer'           // both are TRANSFER-notes (the leaf's Mp=1 kernels; a split-child has no merge kernel)
        || !Buffer.from(spent.owner).equals(vin1Note.owner))                               // same owner (owner_in_self == owner_in_other)
        throw new Error(`HALT covenant_escape: KEY note ${spentKey} in a 2-input tx @${height} is NOT a tight-cap merge (vin1 missing/wrong, non-vout0 inputs, non-transfer provenance, or owner mismatch — the consensus leaf would reject; N9/P4 contradiction)`);
      const merged = mergeCreditAmount(tx, G, spent, vin1Note);                            // BIND amount = vin0.amount + vin1.amount (STORED)
      if (!merged || !Buffer.from(merged.owner).equals(spent.owner))                       // owner_out == owner_in (the leaf welds owner_out to owner_in)
        throw new Error(`HALT covenant_escape: merge ${spentKey}+${vin1Key} @${height} does not bind (amount_out != vin0+vin1, stateOut mismatch, or owner_out != owner_in)`);
      const ctx = { events: [], created: [], burned: 0n };
      this.creditChildV2({ tokenId: G, amount: merged.amount, owner: merged.owner, ownerType: OwnerType.KEY, provenance: 'merge', parentDegree: null, vout: 0 }, txid, tx, height, ctx);
      this.liveNotes.delete(spentKey); this.liveNotes.delete(vin1Key);                     // retire BOTH inputs (the prelude formerly retired only vin0)
      return { events: ctx.events, created: ctx.created, removed: [{ key: spentKey, prevValue: spent }, { key: vin1Key, prevValue: vin1Note }], burned: ctx.burned, decision: 'merge' };
    }
    // From here the note is KNOWN-LIVE ⟹ the covenant ACCEPTED this spend ⟹ P4 MUST bind it or HALT covenant_escape (never silent-ignore).
    // [2] ARM GATE — vinCount is consensus-bound to owner_type (KEY⟹1, SCRIPT⟹2; a KEY 2-input merge was handled above).
    const expect = expectedInputCount(spent.ownerType);
    if (expect === null) throw new Error(`HALT covenant_escape: spend of a terminal/unknown owner_type ${spent.ownerType} note ${spentKey} @${height} (BURN is never live; N9/P4 contradiction)`);
    if (tx.ins.length !== expect) throw new Error(`HALT covenant_escape: vinCount ${tx.ins.length} contradicts owner_type-bound ${expect} for note ${spentKey} @${height}`);
    // SCRIPT + vin1-live ⟹ HALT (eager, GPT brick 6): a SCRIPT-arm spend's vin1 is the genesis-EXTERNAL controller (never in liveNotes).
    // A LIVE vin1 means a token note consumed by a family that does not retire it ⟹ do not wait for the end-of-block sweep.
    if (spent.ownerType === OwnerType.SCRIPT && this.liveNotes.has(vinOutpoint(tx, 1).toString('hex')))
      throw new Error(`HALT covenant_escape: SCRIPT note ${spentKey} co-spent with a LIVE token note @vin1 @${height} — vin1 must be the genesis-external controller (never live; N9/P4 contradiction)`);
    // [3] ABI SELECT by the STORED provenance (NEVER tx shape; 4 / 8 / 3+4·M' are mutually unsolvable ⟹ no reader cross-reads).
    const mono = spent.provenance === 'genesis', merged = spent.provenance === 'merge';
    const Wk = mono ? 4 : merged ? 8 : (3 + 4 * spent.parentDegree);                       // merged ⟹ the merge-parent kernel (Wk=8)
    const parentDeg = spent.parentDegree;                     // null for genesis/merge; the STORED creating-split degree for split/transfer
    // [4a] SPLIT family (M>=2, outs==2M+1).
    const keySplit = spent.ownerType === OwnerType.KEY && isSplitTransferShape(tx, transferSPK);
    const scriptSplit = spent.ownerType === OwnerType.SCRIPT && isScriptSplitShape(tx, transferSPK);
    if (keySplit || scriptSplit) {
      let children;
      if (keySplit) {
        const cands = mono ? splitCandidatesFromWitnessMonoGenesis(tx) : merged ? splitCandidatesFromWitnessMerge(tx) : splitCandidatesFromWitnessStateV2(tx, parentDeg);
        children = cands && splitCreditAmountsV2(tx, spent, cands);
      } else {
        const r = recognizeScriptSplit(tx, transferSPK, spent, parentDeg);     // SCRIPT kernel is never genesis ⟹ state-v2 Wk only
        if (r && r.halt) throw new Error(`HALT covenant_escape: ${r.reason} (note ${spentKey} @${height})`);
        children = r && r.children;
      }
      if (!children) throw new Error(`HALT covenant_escape: live note ${spentKey} split on-chain @${height} but the children do not bind (Σ≠spent or a stateOut mismatch; N9/P4 contradiction)`);
      const M = splitDegree(tx), ctx = { events: [], created: [], burned: 0n };
      for (const c of children) this.creditChildV2({ ...c, provenance: 'split', parentDegree: M }, txid, tx, height, ctx);
      this.liveNotes.delete(spentKey);
      return { events: ctx.events, created: ctx.created, removed: [{ key: spentKey, prevValue: spent }], burned: ctx.burned, decision: 'split' };
    }
    // [4b] 1→1 SEND-ALL family (outs==3): KEY 1-input or SCRIPT 2-input. The full amount is re-emitted (BIND amount = spent.amount).
    const keyMono = spent.ownerType === OwnerType.KEY && isMonoInputTransferShape(tx, transferSPK);
    const scriptMono = spent.ownerType === OwnerType.SCRIPT && isScriptMonoTransferShape(tx, transferSPK);
    if (keyMono || scriptMono) {
      const amount = creditAmount(spent);                                       // BIND — never the witness
      const cand = sendAllCandidateV2(tx, Wk);                                  // owner@w[Wk+10], owner_type@w[Wk+12]; fail-closed
      if (!cand || !verifyOwnerCandidateV2(stateOutHash32(tx.outs[1]), G, amount, cand.ownerType, cand.owner))
        throw new Error(`HALT covenant_escape: live note ${spentKey} sent 1→1 @${height} but out1/owner do not bind (N9/P4 contradiction)`);
      const ctx = { events: [], created: [], burned: 0n };
      // a 1→1 send-all tx IS a degree-1 split (voutCount 3, HDR_T==HDR_S, CONT_MID==splitMid(1)) ⟹ the OUTPUT note's IMMEDIATE parent
      // is THIS tx of degree 1 ⟹ parentDegree=1 (NOT the spent note's degree). A future spend reads it via the Wk=3+4·1=7 state-v2 ABI
      // = the on-chain split kernel with Mp=1 (the transfer-parent base case). Setting it to spent.parentDegree would diverge from the
      // leaf's Wk=7 ⟹ a covenant_escape HALT on every honest transfer-of-transfer (the freeze workflow's flagged ABI divergence).
      this.creditChildV2({ tokenId: G, amount, owner: cand.owner, ownerType: cand.ownerType, provenance: 'transfer', parentDegree: 1, vout: 0 }, txid, tx, height, ctx);
      this.liveNotes.delete(spentKey);
      return { events: ctx.events, created: ctx.created, removed: [{ key: spentKey, prevValue: spent }], burned: ctx.burned, decision: cand.ownerType === OwnerType.BURN ? 'burn' : 'transfer' };
    }
    // [4c] a KNOWN-LIVE note consumed in an unrecognized shape ⟹ HALT (NEVER decision:'skip' for a known-live spend — the silent-
    //      FULL_IGNORE-leaves-note-live hole). The end-of-block SWEEP independently backstops this.
    throw new Error(`HALT covenant_escape: live note ${spentKey} consumed in an unrecognized shape @${height} (N9/P4 contradiction)`);
  }

  // credit ONE child — branch on owner_type BEFORE any liveNotes.set (the v1 split loop set EVERY child unconditionally; under v2
  // that would make a BURN child LIVE + re-spendable = double-count). BURN ⟹ burnedSupply (terminal, no live key, BURN event).
  creditChildV2(c, txid, tx, height, ctx) {
    if (c.ownerType === OwnerType.BURN) {
      this.burnedSupply += c.amount; ctx.burned += c.amount;
      ctx.events.push(encodeEventV2({ type: EventTypeV2.BURN, ownerType: OwnerType.BURN, tokenId: c.tokenId, txidInternal: txid, vout: c.vout, amount: c.amount, owner: c.owner }));
      return;                                                                   // NO liveNotes.set, NO created key
    }
    const key = okey(txid, c.vout);
    // audit G: a live note whose tokenOut is below the dust floor is consensus-real (counted for conservation) but
    // relay-stranded (and KEY notes are 1-input ⇒ no fee top-up ⇒ unspendable in practice). Flag it so the serving
    // layer never presents it as freely spendable. `stranded` is OFF-CHAIN metadata — NOT folded into the genesis-mirror
    // digest (like provenance/parentDegree), so it does not affect 2nd-validator byte-agreement.
    const satValue = Number(tx.outs[c.vout].value);
    const stranded = satValue < Number(TOKEN_VALUE_MIN);
    this.liveNotes.set(key, { tokenId: c.tokenId, amount: c.amount, owner: Buffer.from(c.owner), ownerType: c.ownerType, provenance: c.provenance, parentDegree: c.parentDegree, satValue, stranded, originHeight: height });
    ctx.created.push(key);
    const etype = c.provenance === 'split' ? EventTypeV2.SPLIT_CHILD : c.provenance === 'merge' ? EventTypeV2.MERGE : EventTypeV2.TRANSFER;
    ctx.events.push(encodeEventV2({ type: etype, ownerType: c.ownerType, tokenId: c.tokenId, txidInternal: txid, vout: c.vout, amount: c.amount, owner: c.owner }));
  }

  // apply a block FORWARD on the current tip (no reorg). ORDER-INDEPENDENT (GPT P4 round-11 #4/#2): genesis first, then a
  // FIXPOINT that applies every transfer whose parent note is now live — so an intra-block create-then-spend resolves in ANY
  // RPC/array order (consensus already guarantees parent-before-child; the fixpoint also defends a mis-ordered source). The
  // state-root is canonicalSort over the 101B events (already order-free); the live-note MUTATION is now order-free too, so
  // the "shuffled tx order ⟹ identical root AND identical note set" claim holds end-to-end (not just for the root).
  applyBlockForward({ height, blockhash, prevhash, txs }) {
    const rootBefore = Buffer.from(this.root);
    const liveAtStart = new Set(this.liveNotes.keys());                               // snapshot for the covenant_escape sweep
    const created = [], removed = [], events = [], decisions = [];
    let blockBurned = 0n;                                                             // v2: Σ burned this block (for reorg-safe rollback)
    const run = (tx) => {
      const r = this.applyTx(tx, height);
      // normalize single (genesis/transfer) vs multi (split) returns: events[], created[], removed[] are flattened into the record.
      for (const e of (r.events || (r.event ? [r.event] : []))) events.push(e);
      for (const k of (Array.isArray(r.created) ? r.created : (r.created ? [r.created] : []))) created.push(k);
      for (const x of (Array.isArray(r.removed) ? r.removed : (r.removed ? [r.removed] : []))) removed.push(x);
      blockBurned += (r.burned || 0n);
      decisions.push({ txid: internalTxid(tx).toString('hex'), decision: r.decision });
      return r;
    };
    const pending = txs.map((tx) => tx);
    for (let i = 0; i < pending.length; i++) if (pending[i] && isGenesisTemplate(pending[i], this.deploy)) { run(pending[i]); pending[i] = null; }
    let progress = true;
    while (progress) {                                                                // fixpoint: apply transfers whose parent is now live, any order
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const tx = pending[i]; if (!tx) continue;
        const spk = this.deploy.transferSPK;
        const vin0Note = this.liveNotes.get(vinOutpoint(tx, 0).toString('hex'));
        if (!vin0Note) continue;                                                        // vin0 not (yet) a live note ⟹ not dispatchable
        // RUN any recognizable spend shape (so applyTxV2 dispatches or EAGER-HALTs a malformed known-live spend) — including the v2
        // 2-input SCRIPT and MERGE shapes. The ONE deferral (brick 6): a KEY 2-input MERGE waits until BOTH inputs are live (vin1 may be
        // created later in the same block; running it now would HALT on a not-yet-live vin1). Shape alone can't tell merge from a SCRIPT
        // co-spend (byte-identical at vin2/vout3), so the deferral is gated on the STORED owner_type of vin0.
        const isMrg = this.v2 && isMergeShape(tx, spk);
        const shaped = isMonoInputTransferShape(tx, spk) || isSplitTransferShape(tx, spk) || (this.v2 && (isScriptSplitShape(tx, spk) || isScriptMonoTransferShape(tx, spk))) || isMrg;
        let ready = shaped;
        if (ready && isMrg && vin0Note.ownerType === OwnerType.KEY && !this.liveNotes.has(vinOutpoint(tx, 1).toString('hex'))) ready = false; // defer the merge until vin1 is live
        if (ready) { run(tx); pending[i] = null; progress = true; }
      }
    }
    // covenant_escape SWEEP (backstop to the in-applyTx throw, also catches a too-strict SHAPE predicate): any covenant note
    // we knew (live-at-start OR created this block) whose outpoint was consumed by a confirmed vin MUST have been removed.
    // A consumed-but-still-live covenant note = the covenant accepted a spend P4 did not account for ⟹ HALT.
    const createdSet = new Set(created);
    for (const tx of txs) for (const vin of tx.ins) {
      const k = okey(vin.hash, vin.index);
      if ((liveAtStart.has(k) || createdSet.has(k)) && this.liveNotes.has(k))
        throw new Error(`HALT covenant_escape: live note ${k} was spent on-chain @${height} but P4 produced no transfer (N9/P4 contradiction; full reindex / external audit)`);
    }
    const sortedEvents = this.v2 ? canonicalSortV2(events) : canonicalSort(events);   // total order over the events (102B v2 / 101B v1)
    for (const e of sortedEvents) this.root = this.v2 ? foldEventV2(this.root, e) : foldEvent(this.root, e);
    this.records.push({ height, blockhash, prevhash, rootBefore, rootAfter: Buffer.from(this.root), delta: { created, removed, burned: blockBurned }, sortedEvents, decisions });
    if (this.v2) this.checkSupplyV2(height);                                          // global Σ(live)+burned==AMOUNT_0 backstop
    return { root: Buffer.from(this.root), events: sortedEvents };
  }

  // v2 GLOBAL conservation backstop — implied by per-tx Σ==spent.amount + mint==AMOUNT_0, so a violation is a code bug (double-credit,
  // missed delete, a both-burned-and-lived child). HARD-HALT. Called after each block AND after a rollback (the live/burned set moved).
  checkSupplyV2(height) {
    if (this.mintCount > 1) throw new Error(`HALT: mintCount ${this.mintCount} > 1 @${height} — a second genesis (impossible for a fixed-supply token)`);
    if (this.mintCount === 1) {
      let live = 0n;
      for (const n of this.liveNotes.values()) {
        if (n.ownerType === OwnerType.BURN) throw new Error(`HALT: a BURN note is LIVE @${height} — burn must be terminal (supply double-count)`);
        live += n.amount;
      }
      if (live + this.burnedSupply !== this.deploy.AMOUNT_0)
        throw new Error(`HALT: Σ(live)=${live} + burned=${this.burnedSupply} != AMOUNT_0=${this.deploy.AMOUNT_0} @${height} (conservation broken)`);
    }
  }

  // roll back every block ABOVE forkHeight (reverse order): delete created (full purge — same-outpoint CRITICAL), un-spend removed.
  rollbackTo(forkHeight) {
    while (this.tip && this.tip.height > forkHeight) {
      const rec = this.records.pop();
      for (const key of rec.delta.created) this.liveNotes.delete(key);              // full purge of branch-A creates (same-outpoint CRITICAL)
      for (const { key, prevValue } of rec.delta.removed) this.liveNotes.set(key, prevValue); // un-spend
      this.burnedSupply -= (rec.delta.burned || 0n);                               // v2: un-burn the rolled-back branch (else Σ inflates forever)
      for (const e of rec.sortedEvents) if (e[0] === EventType.MINT) this.mintCount--; // MINT byte 0x00 in BOTH wire versions
      this.root = Buffer.from(rec.rootBefore);
    }
    if (this.v2) this.checkSupplyV2(forkHeight);                                    // conservation must hold on the rolled-back-to state
  }

  // REORG-AWARE block ingestion. Extends the tip if prevhash matches; else rolls back to the fork (a stored block whose
  // hash == this block's prevhash) and applies. HALT if the reorg depth exceeds REORG_HORIZON (force a full reindex).
  processBlock(block) {
    const tip = this.tip;
    if (!tip || block.prevhash === tip.blockhash) return this.applyBlockForward(block);
    const fork = this.records.find((r) => r.blockhash === block.prevhash);
    if (!fork) throw new Error(`reorg: parent ${block.prevhash} not in retained records — supply the branch from a known block or full reindex`);
    const depth = tip.height - fork.height;
    if (depth > this.reorgHorizon) throw new Error(`HALT: reorg depth ${depth} > REORG_HORIZON ${this.reorgHorizon} — forced full reindex (never silently wrong)`);
    this.rollbackTo(fork.height);
    return this.applyBlockForward(block);
  }

  // deterministic digest of the live set (for the 2nd-validator byte-agreement). v2 folds owner_type (key/script supply are distinct
  // sub-ledgers — a 32-zero seed + owner_type-blind fold lets a KEY↔SCRIPT divergence pass undetected) + the burnedSupply scalar
  // (two lines with identical live sets but different burn totals must differ), domain-seeded S(RULESET_TAG_V2). provenance/parentDegree
  // are off-chain attribution metadata (a deterministic function of the chain) — NOT folded (two conformant validators may store them
  // differently but must AGREE on dispatch). v1 path = byte-identical to before (the existing v1 tests are untouched).
  noteSetDigest() {
    const S = bells.crypto.sha256;
    if (!this.v2) {
      let acc = Buffer.alloc(32);
      for (const k of [...this.liveNotes.keys()].sort()) {
        const n = this.liveNotes.get(k); const amt = Buffer.alloc(8); amt.writeBigUInt64LE(n.amount);
        acc = S(Buffer.concat([acc, Buffer.from(k, 'hex'), n.tokenId, amt, n.owner]));
      }
      return acc;
    }
    let acc = S(RULESET_TAG_V2);                                                      // v2 domain seed (cross-version isolation)
    for (const k of [...this.liveNotes.keys()].sort()) {
      const n = this.liveNotes.get(k);
      if (n.ownerType === OwnerType.BURN) throw new Error('HALT: a BURN note is LIVE in the digest — burn must be terminal');
      const amt = Buffer.alloc(8); amt.writeBigUInt64LE(n.amount);
      acc = S(Buffer.concat([acc, Buffer.from(k, 'hex'), n.tokenId, amt, Buffer.from([n.ownerType]), n.owner]));
    }
    const burned = Buffer.alloc(8); burned.writeBigUInt64LE(this.burnedSupply);       // fold the burned-supply scalar into the final acc
    return S(Buffer.concat([acc, burned]));
  }
}

export function indexChain(deploy, blocks) {
  const ix = new Indexer(deploy);
  for (const b of blocks) ix.processBlock(b);
  return ix;
}
