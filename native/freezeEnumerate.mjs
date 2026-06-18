// P2-0 FREEZE — STEP 5: the COMPLETE leaf enumeration for the $BOUND v2 taptree. ONE source-of-truth tuple list, ALL leaves built
// from ONE frozen consts object (so the mint tx + every leaf share one source). The taptree root over THIS set = the permanent
// covenant address (transferSPK). A note class with no leaf here is unspendable forever — so the cardinal-rule coverage test asserts
// every note shape (mint, split-child, transfer-note[Mp=1], SCRIPT, with each grandparent shape) maps to a leaf.
//
// THE TUPLE SPACE (each is distinct bytes — Mp/j/M/Mp_gp/arm are all leaf-baked constants):
//   ROOT (spend the MINT note, KEY-only): splitAMonoV2Ops M∈{2,3,4} + transferAMonoV2Ops = 4.
//   FamA split-child spend: (Mp∈{1,2,3,4}, j∈{0..Mp-1}) × M∈{2,3,4} × gp∈{genesis,transfer,split-2,split-3,split-4} × arm∈{key,script}.
//   FamB 1→1 send-all:       (Mp,j) × gp × arm.
//   Mp=1 = the TRANSFER-parent base case (a 1→1 tx is a degree-1 split). (Mp,j) pairs = Σ_{1..4} Mp = 10.
//   ⟹ FamA = 10·3·5·2 = 300, FamB = 10·5·2 = 100, ROOT = 4 → 404 (TIER-FULL key+script). KEY-only (SCRIPT deferred) = 204.
import * as bells from 'belcoinjs-lib';
import { splitAMonoV2Ops, transferAMonoV2Ops } from './p1e3MonoGenesisV2.mjs';
import {
  splitFullLineageGenesisGrandparentV2Ops, splitFullLineageTransferGrandparentV2Ops, splitFullLineageSplitGrandparentV2Ops,
  transferGenesisGrandparentV2Ops, transferTransferGrandparentV2Ops, transferSplitGrandparentV2Ops,
} from './p1e3SplitGrandparentV2.mjs';
import { mergeK2V2LineageOps } from './p1e3MergeK2V2.mjs';
import {
  mergeSpendVia1to1Ops, mergeSpendViaSplitOps, transferMergeGrandparentV2Ops, splitMergeGrandparentV2Ops,
} from './p1e3MergeLineageV2.mjs';

const N = 8;
const opsOf = (r) => Array.isArray(r) ? r : r.ops;   // grandparent composers return an ops array; root composers return {ops}
// the changeSPK const is UNUSED when changeWitness=true (the leaf reads the witness change) but the leaf still validates it is 34B.
// Force a FIXED placeholder so the root is reproducible regardless of any caller-supplied changeSPK (it cannot affect the leaf bytes).
const CHANGE_PLACEHOLDER = Buffer.concat([Buffer.from([0x51, 0x20]), Buffer.alloc(32)]);

// enumerate the complete leaf set. opts.arms = ['key'] for TIER-MIN (SCRIPT emission forbidden) or ['key','script'] for TIER-FULL.
// changeWitness MUST be true (the single uniform ABI — const-change is the centralization/permanence trap).
export function enumerateLeaves(consts, { arms = ['key', 'script'] } = {}) {
  if (consts.changeWitness !== true) throw new Error('FREEZE: changeWitness must be true (the single uniform ABI)');
  consts = { ...consts, changeSPK: CHANGE_PLACEHOLDER };  // force the unused 34B placeholder (reproducible root)
  const Mp_gps = [2, 3, 4], Ms = [2, 3, 4], gpSplit = Mp_gps.map((g) => ['split', g]);
  const leaves = [];
  const push = (id, ops) => { let leaf; try { leaf = bells.script.compile(ops); } catch (e) { throw new Error(`FREEZE enumerate: leaf ${JSON.stringify(id)} failed to build: ${e.message}`); } leaves.push({ id, leaf }); };

  // ROOT (spend the mint note) — KEY-only (the mint note is always KEY-owned by OWNER_0).
  for (const M of Ms) push({ fam: 'root-split', M }, opsOf(splitAMonoV2Ops(M, N, consts)));
  push({ fam: 'root-sendall' }, opsOf(transferAMonoV2Ops(N, consts)));

  // FamA (split-child spend) + FamB (1→1 send-all), for each (Mp, j), each grandparent shape, each arm.
  for (const Mp of [1, 2, 3, 4]) for (let j = 0; j < Mp; j++) for (const arm of arms) {
    const c = { ...consts, arm };
    // gp = genesis
    for (const M of Ms) push({ fam: 'split', Mp, j, M, gp: 'genesis', arm }, splitFullLineageGenesisGrandparentV2Ops(Mp, j, M, N, c));
    push({ fam: '1to1', Mp, j, gp: 'genesis', arm }, transferGenesisGrandparentV2Ops(Mp, j, N, c));
    // gp = transfer (the grandparent was itself a 1→1)
    for (const M of Ms) push({ fam: 'split', Mp, j, M, gp: 'transfer', arm }, splitFullLineageTransferGrandparentV2Ops(Mp, j, M, N, c));
    push({ fam: '1to1', Mp, j, gp: 'transfer', arm }, transferTransferGrandparentV2Ops(Mp, j, N, c));
    // gp = split (degree Mp_gp)
    for (const [, Mp_gp] of gpSplit) {
      for (const M of Ms) push({ fam: 'split', Mp, j, M, gp: 'split', Mp_gp, arm }, splitFullLineageSplitGrandparentV2Ops(Mp, j, M, N, Mp_gp, c));
      push({ fam: '1to1', Mp, j, gp: 'split', Mp_gp, arm }, transferSplitGrandparentV2Ops(Mp, j, N, Mp_gp, c));
    }
    // gp = merge (the grandparent was a MERGE tx — a merged note can be deposited key→script, so this is per-arm) [+80 / +40 KEY-only]
    for (const M of Ms) push({ fam: 'split', Mp, j, M, gp: 'merge', arm }, opsOf(splitMergeGrandparentV2Ops(Mp, j, M, N, c)));
    push({ fam: '1to1', Mp, j, gp: 'merge', arm }, opsOf(transferMergeGrandparentV2Ops(Mp, j, N, c)));
  }

  // ----- the MERGE family (K=2, KEY-only). +2 execution + 4 direct-spend (Mp='merge') = +6 (KEY-only, arm-independent). -----
  // EXECUTION: spend two KEY notes into one (side0/side1 = the two leaf instances of a merge tx).
  push({ fam: 'merge', side: 0 }, opsOf(mergeK2V2LineageOps(0, consts)));
  push({ fam: 'merge', side: 1 }, opsOf(mergeK2V2LineageOps(1, consts)));
  // DIRECT-SPEND a merged note (Mp='merge', the immediate parent IS the merge tx; gp=its vin0 source, a 1→1 transfer). KEY-only
  // (a merged note is owner_type=KEY-pinned). Split into M children, or 1→1 send-all.
  const ck = { ...consts, arm: 'key' };
  for (const M of Ms) push({ fam: 'split', Mp: 'merge', j: 0, M, gp: 'transfer', arm: 'key' }, opsOf(mergeSpendViaSplitOps(M, ck)));
  push({ fam: '1to1', Mp: 'merge', j: 0, gp: 'transfer', arm: 'key' }, opsOf(mergeSpendVia1to1Ops(ck)));
  return leaves;
}

// the deterministic leaf-ID ordering (familyByte, Mp, j, M, Mp_gp, arm) — the taptree leaf order MUST be canonical so the root is
// reproducible by an independent auditor. familyByte: root-split=0, root-sendall=1, split=2, 1to1=3. gp: genesis=0,transfer=1,split=2.
const FAM = { 'root-split': 0, 'root-sendall': 1, split: 2, '1to1': 3, merge: 4 };
const GP = { genesis: 0, transfer: 1, split: 2, merge: 3 };
const mpNum = (mp) => mp === 'merge' ? 5 : (mp ?? 0);   // Mp='merge' (the immediate parent IS a merge tx) sorts after Mp∈{1..4}
export const leafIdKey = (id) => [FAM[id.fam], mpNum(id.Mp), id.j ?? 0, id.M ?? 0, GP[id.gp] ?? 0, id.Mp_gp ?? 0, id.arm === 'script' ? 1 : 0, id.side ?? 0];
export function orderLeaves(leaves) {
  return [...leaves].sort((a, b) => { const ka = leafIdKey(a.id), kb = leafIdKey(b.id); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
}

// ----- STEP 6: the taptree BUILDER (deterministic root → transferSPK + per-leaf control blocks). NUMS internal key = the BIP-341 'H'
//       point (key-path provably dead IF dlog(H) unknown — pin + audit before freeze). The SPK (0x5120 ‖ x(Q)) is NETWORK-INDEPENDENT;
//       only the bech32m address is network-specific. The root is reproducible by an independent auditor (the 2nd-validator property).
// NUMS internal key = the BIP-341 'H' point: its x-coordinate is SHA256(uncompressed secp256k1 G) = SHA256(0x04‖Gx‖Gy). Because the
// x-coord is a HASH OUTPUT (not a chosen value), no one knows the discrete log of H ⟹ the taproot KEY-PATH is provably DEAD ⟹
// every spend MUST take a script-path (one of the enumerated leaves). A keyed internal point would bypass every leaf = total theft of
// all supply — this nothing-up-my-sleeve derivation is the proof it cannot happen. PINNED + reproducible: docs/NUMS_PIN.md (the auditor
// doc); VERIFIED in native/nums_pin.test (derivation + published-BIP-341-H anchor + liftability + 2nd-validator) + freeze_enumerate.test.
export const NUMS = Buffer.from('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0', 'hex');
const NET = { messagePrefix: '', bech32: 'bc', bip32: { public: 0, private: 0 }, pubKeyHash: 0x19, scriptHash: 0x1e, wif: 0x99 };

// a deterministic BALANCED binary Taptree over the canonically-ordered leaves (split each list at the midpoint). Same leaf set +
// same order ⟹ same tree ⟹ same root, on any conformant implementation.
function balancedTree(nodes) {
  if (nodes.length === 1) return nodes[0];
  const mid = Math.ceil(nodes.length / 2);
  return [balancedTree(nodes.slice(0, mid)), balancedTree(nodes.slice(mid))];
}

// buildTaptree → { transferSPK(34B), depth, ordered, scriptTree, controlBlockFor(leaf) }. The SPK is the PERMANENT covenant address.
export function buildTaptree(consts, opts = {}) {
  const ordered = orderLeaves(enumerateLeaves(consts, opts));
  const scriptTree = balancedTree(ordered.map((l) => ({ output: l.leaf })));
  const p = bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, network: NET });
  const depth = Math.ceil(Math.log2(ordered.length));
  const controlBlockFor = (leaf) => {
    const pl = bells.payments.p2tr({ internalPubkey: NUMS, scriptTree, redeem: { output: leaf, redeemVersion: 0xc0 }, network: NET });
    return pl.witness[pl.witness.length - 1];
  };
  return { transferSPK: p.output, depth, ordered, scriptTree, controlBlockFor };
}

// the WORST single stack element a leaf builds = the largest tx-reconstruction preimage just before its hash256 (the three large
// accumulators — parent, grandparent, c6 — are built SEQUENTIALLY and each hash256'd to 32B before the next, so they NEVER
// concatenate; the global max is one preimage). Byte-exact formula (a v2 stateOut is SHA256'd to 32B BEFORE entering the tx
// accumulator, so the +1-byte owner_type does not inflate it): tokenOut=stateOut=changeOut=43B, output pair=86B, splitMid=6B.
//   split parent (degree d):   HDR_S(5)+vin0(36)+splitMid(6)+ d·86 +change(43)+locktime(4) = 94 + 86·d.
//   genesis parent/gp:         HDR_G(5)+mintOutpoint(36)+genMid(47)+tokenNote0(43)+stateOut0(43)+feeOut(43)+change(43)+locktime(4)=264.
//   transfer gp:               HDR_T(5)+vin(36)+CONT_MID(6)+tokenOut(43)+stateOut(43)+change(43)+locktime(4)=180.
//   c6 (current outputs, M):   M·86 + change(43) = 43 + 86·M.
// VERIFIED against the freeze review's instrumented run: c6@M=4 = 387B (43+86·4) ✓, parent@Mp=4 = 438B (94+86·4) ✓. M_MAX=4 ⟹ the
// global worst is 438B < the 520B MAX_SCRIPT_ELEMENT_SIZE; M=5 would cross 520 on the c6 preimage (which is WHY M_MAX=4).
const splitParentPre = (d) => 94 + 86 * d, GENESIS_PRE = 264, TRANSFER_GP_PRE = 180, c6Pre = (m) => 43 + 86 * m;
// the merge-tx reconstruction preimage (2-input/3-output): HDR_G(5)+vin0(36)+VINTAIL(5)+vin1(36)+CONT_MID(6)+tokenOut0(43)+stateOut0(43)+change(43)+locktime(4).
const MERGE_PARENT_PRE = 221;
export function maxStackElement(id) {
  if (id.fam === 'root-split') return Math.max(GENESIS_PRE, c6Pre(id.M));
  if (id.fam === 'root-sendall') return Math.max(GENESIS_PRE, c6Pre(1));
  if (id.fam === 'merge') return Math.max(splitParentPre(1), TRANSFER_GP_PRE, c6Pre(1));  // 2 transfer parents (Mp=1) + 2 transfer gps + 1-output c6
  const parent = id.Mp === 'merge' ? MERGE_PARENT_PRE : splitParentPre(id.Mp);   // Mp='merge' ⟹ the immediate parent is the merge tx
  const gp = id.gp === 'merge' ? MERGE_PARENT_PRE : id.gp === 'genesis' ? GENESIS_PRE : id.gp === 'split' ? splitParentPre(id.Mp_gp) : TRANSFER_GP_PRE;
  const cur = id.fam === 'split' ? c6Pre(id.M) : c6Pre(1);                       // split = M outputs; 1to1 = 1
  return Math.max(parent, gp, cur);
}

// the COMPLETE expected tuple space — generated INDEPENDENTLY of enumerateLeaves (E-2 fix: the cardinal-rule guard must NOT be
// circular — it iterates EVERY (Mp,j,M,gp,Mp_gp,arm) a holder can reach and demands a leaf, so a single dropped cell is caught).
//   mint        → root-split M∈{2,3,4} + root-sendall (KEY-only).
//   split-child → split/1to1 with Mp∈{1,2,3,4}, j∈0..Mp-1 (Mp=1 = the transfer-parent base case), M∈{2,3,4}, every gp shape, every arm.
//   gp shapes   → genesis, transfer, split with Mp_gp∈{2,3,4}.
// ROOT(4) + MERGE exec+direct(6, KEY-only) + per-arm 240 [FamA 10·3·6gp=180 + FamB 10·6gp=60] (the 6th gp = 'merge'). TIER-FULL = 490, KEY-only = 250.
export const STRUCTURAL_LEAF_COUNT = (arms) => 10 + arms.length * 240;
export function expectedLeafIds({ arms = ['key', 'script'] } = {}) {
  const ids = [];
  for (const M of [2, 3, 4]) ids.push({ fam: 'root-split', M });
  ids.push({ fam: 'root-sendall' });
  const gps = [{ gp: 'genesis' }, { gp: 'transfer' }, ...[2, 3, 4].map((g) => ({ gp: 'split', Mp_gp: g })), { gp: 'merge' }];
  for (const arm of arms) for (const Mp of [1, 2, 3, 4]) for (let j = 0; j < Mp; j++) for (const g of gps) {
    for (const M of [2, 3, 4]) ids.push({ fam: 'split', Mp, j, M, ...g, arm });
    ids.push({ fam: '1to1', Mp, j, ...g, arm });
  }
  // MERGE family (KEY-only, arm-independent): execution (side0/1) + direct-spend a merged note (Mp='merge').
  ids.push({ fam: 'merge', side: 0 }, { fam: 'merge', side: 1 });
  for (const M of [2, 3, 4]) ids.push({ fam: 'split', Mp: 'merge', j: 0, M, gp: 'transfer', arm: 'key' });
  ids.push({ fam: '1to1', Mp: 'merge', j: 0, gp: 'transfer', arm: 'key' });
  return ids;
}
// the per-note-class COVERAGE proof (the cardinal rule): EVERY reachable (Mp,j,M,gp,Mp_gp,arm) maps to EXACTLY one enumerated leaf,
// there is NO extra leaf, and the count equals the structural total. Returns [] iff coverage is complete + exact.
export function coverageGaps(leaves, { arms = ['key', 'script'] } = {}) {
  const gaps = [];
  const k = (id) => leafIdKey(id).join(',');
  const have = new Set(leaves.map((l) => k(l.id)));
  const expected = expectedLeafIds({ arms });
  const expKeys = new Set();
  for (const id of expected) { const key = k(id); expKeys.add(key); if (!have.has(key)) gaps.push(`MISSING reachable leaf ${JSON.stringify(id)} — that note class would be PERMANENTLY UNSPENDABLE`); }
  for (const l of leaves) if (!expKeys.has(k(l.id))) gaps.push(`UNEXPECTED leaf ${JSON.stringify(l.id)} — not in the reachable tuple space`);
  const want = STRUCTURAL_LEAF_COUNT(arms);
  if (leaves.length !== want) gaps.push(`leaf COUNT ${leaves.length} != structural ${want} (4 root + ${arms.length}·200)`);
  if (expected.length !== want) gaps.push(`INTERNAL: expected-set size ${expected.length} != ${want} (tuple-space generator drift)`);
  return gaps;
}
