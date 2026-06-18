// audit O (2026-06-15) — the FREEZE MANIFEST generator. The permanent genesis decisions are otherwise scattered across
// code + docs; this emits ONE signed-able object (+ markdown) capturing exactly what the frozen transferSPK commits to,
// so a 3rd party can reproduce + sign off the root before genesis. Run at freeze time with the REAL deploy + decisions.
import { buildTaptree, NUMS, enumerateLeaves } from './freezeEnumerate.mjs';
import { TOKEN_VALUE_MIN } from './wire.mjs';
import { independentTransferSPK, NUMS_INDEP } from './independentRoot.mjs';

const bi = (v) => (typeof v === 'bigint' ? v.toString() : String(v));

export function buildFreezeManifest(deploy, { bellsBuild = null, activationProof = null, testResultHash = null, decisions = {} } = {}) {
  const arms = deploy.arms ?? ['key', 'script'];
  const leaves = enumerateLeaves(deploy.consts, { arms });
  const t = buildTaptree(deploy.consts, { arms });
  const indep = independentTransferSPK(leaves);                 // Result-6: independent re-derivation
  const tier = arms.includes('script') ? 'TIER-FULL' : 'TIER-MIN';
  return {
    schema: 'opcat-native-token/freeze-manifest-v1',
    token: {
      token_id: deploy.G.toString('hex'), AMOUNT_0: bi(deploy.AMOUNT_0), OWNER_0: deploy.OWNER_0.toString('hex'),
      VALUE_0: bi(deploy.VALUE_0), feeOut: deploy.feeOut.toString('hex'), changeSpkLen: deploy.changeSpkLen, wireVersion: deploy.wireVersion ?? 'v2',
    },
    root: {
      transferSPK: t.transferSPK.toString('hex'),
      independentTransferSPK: indep.toString('hex'),
      rootsAgree: t.transferSPK.equals(indep),                  // MUST be true to freeze
      depth: t.depth, leafCount: leaves.length, arms, tier,
    },
    nums: { internalKey: NUMS.toString('hex'), independentNums: NUMS_INDEP.toString('hex'), numsAgree: NUMS.equals(NUMS_INDEP), derivation: 'SHA256(0x04 || Gx || Gy) = BIP-341 H; dlog unknown => key-path dead' },
    policy: {
      TOKEN_VALUE_MIN: bi(TOKEN_VALUE_MIN),
      dustFloor: decisions.dustFloor ?? 'DECIDED (2026-06-15) — OFF-CHAIN floor: wallet+P4 enforce TOKEN_VALUE_MIN=546 (above the ~330-sat P2TR relay-dust floor measured on-node); NO on-chain DUST_FLOOR (would change the root). Residual: a hand-crafted sub-floor KEY note is permanently unspendable (self-inflicted, never theft/inflation) and P4 flags it stranded. No root change.',
      burnSatPolicy: decisions.burnSatPolicy ?? 'DECIDED (2026-06-15) — BURN-AS-TRANSITION (re-emit owner_type=BURN via the existing split/1->1 leaves, NO new leaf); accept that the BURN tokenOut locks its BELLS; wallet funds every burn at exactly TOKEN_VALUE_MIN so the locked amount is bounded (~546 sats). DEFERRED (revisit ONLY at leaf-set finalization, the LAST window): an OP_RETURN burn would recover those sats and avoid a dust UTXO, but needs a new output topology = new leaf family = root inclusion; not worth ~546 sats/burn. CANNOT be added post-freeze (immutable SPK).',
      controllerPolicy: decisions.controllerPolicy ?? (arms.includes('script') ? 'TBD — REQUIRED for TIER-FULL: only no-key-path, state-lineage, pool_id/state_id-bound controllers; wallet/deposit/indexer must refuse others' : 'n/a (TIER-MIN excludes the SCRIPT arm)'),
      merge: decisions.merge ?? 'DECIDED (2026-06-15) — BUILD a merge leaf (K=2, KEY-only, single-owner) BEFORE genesis (root change). Design verdict (9-agent workflow): sound conservation REQUIRES DUAL-BACKTRACE (each of the 2 leaf instances backtraces BOTH inputs — a free partner amount = mint-from-nothing), which makes leaf-count QUADRATIC in input shapes (~5000/arm uncapped) ⇒ MUST freeze a TIGHTLY-CAPPED merge (canonical/normalized input shapes; the cap is itself a genesis-permanent root decision). "No-merge-ever" REJECTED (max payment = largest single note, permanent fragmentation, un-addable post-freeze, contradicts the DeFi thesis). THREE freeze-blockers: (1) peakStack<1000 — ✅ CLEARED (measured peak_dual=133 vs 1000 on a faithful worst-case dual-backtrace run, native/_audit_merge_peak.mjs; lower than the split baseline 145 because M_out=1 + sequential kernels); (2) re-decide the vinCount<->owner_type bijection (a KEY merge is 2-input, breaks the SCRIPT-recognizer invariant — dispatch on stored owner_type) + multi-input ingest retirement [WORK]; (3) a new gp=merge kernel/grandparent arm so a merged note is spendable (owner_type_out==KEY hard-pin contains the ripple) [WORK]. CAP = TIGHT (canonical double-normalized inputs: parent + grandparent both 1->1 transfer). Leaf delta (GPT-reviewed 2026-06-16): ~+6 execution leaves (side0/side1 + mergeParentReconstruct direct-spend) + ~+80 reachability leaves (gp=merge on split/1->1 x arms) = ~+86 ⇒ total ~490 < 512 ⇒ taptree stays depth 9, no per-spend witness tax; wallet does up to 2 prep-sends before a rare merge. STATUS: feasibility PROVEN (peak 133), conservation keystone PROVEN (mergeConservationOps 6/6), scope+cap LOCKED; full leaf + mergeParentReconstruct + gp=merge + per-family indexer dispatch + freeze enum still to build.',
    },
    build: {
      bellsBuild: bellsBuild ?? 'TBD — record subversion (/Bells:x.y.z/) + commit hash of the sign-off binary',
      activationProof: activationProof ?? 'TBD — getdeploymentinfo opcat.active + required script_flags on the TARGET chain (see assertGenesisLaunchSafe)',
      testResultHash: testResultHash ?? 'TBD — hash of the green suite + the on-node command log',
    },
    irreversible: 'PERMANENT post-genesis: transferSPK (leaf set + ordering + NUMS), state v2 wire (66B), M_MAX=4, the dust/BURN/merge/controller decisions above. None can change without minting a new token.',
  };
}

export function renderManifestMarkdown(m) {
  const L = [];
  L.push(`# $BOUND FREEZE MANIFEST (${m.root.tier})`, '', `schema: \`${m.schema}\``, '');
  L.push('## Root (PERMANENT)', `- transferSPK: \`${m.root.transferSPK}\``, `- independent re-derivation: \`${m.root.independentTransferSPK}\``, `- **rootsAgree: ${m.root.rootsAgree}** (must be true)`, `- depth ${m.root.depth}, leaves ${m.root.leafCount}, arms [${m.root.arms}]`, '');
  L.push('## NUMS', `- internal key: \`${m.nums.internalKey}\``, `- numsAgree: ${m.nums.numsAgree} — ${m.nums.derivation}`, '');
  L.push('## Token', ...Object.entries(m.token).map(([k, v]) => `- ${k}: \`${v}\``), '');
  L.push('## Policy decisions (resolve every TBD before genesis)', ...Object.entries(m.policy).map(([k, v]) => `- **${k}**: ${v}`), '');
  L.push('## Build / activation', ...Object.entries(m.build).map(([k, v]) => `- ${k}: ${v}`), '');
  L.push('', `> ${m.irreversible}`);
  return L.join('\n');
}
