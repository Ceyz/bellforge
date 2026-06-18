// P4 STEP 1 — the per-token DEPLOY descriptor: load the operator's genesis params, DERIVE transferSPK + stateOut0 (P4
// derives them, never trusts a supplied SPK), and SELF-VALIDATE against the chain at genesis discovery (a 1-byte-off
// descriptor must HALT loudly, not silently recognize zero notes). The descriptor is the v1 trust input (operator-set).
import { makeCovenantRaw } from '../../canaries/tap.mjs';
import { buildP1e3FullScript } from '../p1e3Covenant.mjs';
import { deriveStateOut0, deriveStateOut0V2, isGenesisTemplate } from './predicates.mjs';
import { buildTaptree, enumerateLeaves, coverageGaps } from '../freezeEnumerate.mjs';

// consts = { tokenId(=G), AMOUNT_0(bigint), OWNER_0(20B), VALUE_0(bigint), feeOut(Buffer), changeSpkLen(=34) }
export function buildDeploy({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34 }) {
  if (typeof AMOUNT_0 !== 'bigint' || AMOUNT_0 < 0n || AMOUNT_0 >= (1n << 63n)) throw new Error(`AMOUNT_0 must be a bigint in [0, 2^63): ${AMOUNT_0}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId (G) must be 36 bytes');
  if (!Buffer.isBuffer(OWNER_0) || OWNER_0.length !== 20) throw new Error('OWNER_0 must be 20 bytes');
  const consts = { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen };
  const transferSPK = makeCovenantRaw(buildP1e3FullScript(consts)).output;     // DERIVED (= the on-chain N9 leaf SPK)
  if (transferSPK.length !== 34) throw new Error('derived transferSPK must be 34 bytes (P2TR)');
  const stateOut0 = deriveStateOut0(consts);                                    // FRAME ‖ SHA256(encodeState({G,AMOUNT_0,OWNER_0}))
  return { G: tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen, transferSPK, stateOut0, consts };
}

// the v2 (TIER-FULL) descriptor. The genesis note is minted v2-66B (stateOut0 = deriveStateOut0V2, owner_type=KEY), and transferSPK
// is the v2 COVENANT TAPTREE address (the merklized root-spend + child-spend leaf set — split-a-mono M∈{2,3,4}, the genesis send-all,
// the split-child leaf, 1→1, SCRIPT arm, grandparents). That taptree root is computed + frozen downstream (the FREEZE step), so it is
// PASSED here (the indexer never re-derives the leaf; it only needs the covenant address for isCovenantOut0 + the genesis recon).
// wireVersion:'v2' gates the indexer onto the v2 dispatch tree + encodeEventV2 + ZERO_ROOT_V2 + the owner_type/burnedSupply digest.
export function buildDeployV2({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, transferSPK }) {
  if (typeof AMOUNT_0 !== 'bigint' || AMOUNT_0 < 0n || AMOUNT_0 >= (1n << 63n)) throw new Error(`AMOUNT_0 must be a bigint in [0, 2^63): ${AMOUNT_0}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId (G) must be 36 bytes');
  if (!Buffer.isBuffer(OWNER_0) || OWNER_0.length !== 20) throw new Error('OWNER_0 must be 20 bytes');
  if (!Buffer.isBuffer(transferSPK) || transferSPK.length !== 34) throw new Error('v2 transferSPK (the covenant taptree address) must be 34 bytes');
  const consts = { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen };
  const stateOut0 = deriveStateOut0V2({ tokenId, AMOUNT_0, OWNER_0, ownerType: 0x00 });          // FRAME ‖ SHA256(encodeStateV2({KEY,G,AMOUNT_0,OWNER_0}))
  return { G: tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen, transferSPK, stateOut0, consts, wireVersion: 'v2' };
}

// freezeDeploy — the PRODUCTION ($BOUND) descriptor: transferSPK is DERIVED from the COMPLETE leaf set (the taptree merkle root
// tweaked onto NUMS), NOT a trusted parameter. This DE-CIRCULARIZES the trust: buildDeployV2 took transferSPK as a passed value and
// selfValidateAtGenesis only checked out0==that value (proving nothing about leaf coverage — a wrong/under-covered root passed). Here
// the root IS f(leaf set), so genesis out0 == transferSPK PROVES out0 commits to EXACTLY this enumerated set (every spendable leaf).
// arms = ['key','script'] (TIER-FULL, 404 leaves) or ['key'] (TIER-MIN, 204 — SCRIPT deferred). All consts from ONE object so the
// mint tx + every leaf share one source. assertLeafCoverage(deploy) re-derives + checks (the 2nd-validator agreement on the root).
export function freezeDeploy({ tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen = 34, arms = ['key', 'script'] }) {
  if (typeof AMOUNT_0 !== 'bigint' || AMOUNT_0 < 0n || AMOUNT_0 >= (1n << 63n)) throw new Error(`AMOUNT_0 must be a bigint in [0, 2^63): ${AMOUNT_0}`);
  if (!Buffer.isBuffer(tokenId) || tokenId.length !== 36) throw new Error('tokenId (G) must be 36 bytes');
  if (!Buffer.isBuffer(OWNER_0) || OWNER_0.length !== 20) throw new Error('OWNER_0 must be 20 bytes');
  const consts = { tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen, changeWitness: true };
  const { transferSPK } = buildTaptree(consts, { arms });                                          // DERIVED = the leaf-set merkle root
  if (transferSPK.length !== 34) throw new Error('derived transferSPK must be 34 bytes (P2TR)');
  // E-2 fix: the TRUE total-coverage gate in the PRODUCTION path (not a test-only ===404). A dropped reachable cell strands holders
  // forever on the permanent SPK, and the de-circularization (out0==root) is VACUOUS for an under-covered set — so check coverage HERE.
  const gaps = coverageGaps(enumerateLeaves(consts, { arms }), { arms });
  if (gaps.length) throw new Error(`FREEZE coverage incomplete (would strand notes on the permanent SPK): ${gaps.join(' | ')}`);
  const stateOut0 = deriveStateOut0V2({ tokenId, AMOUNT_0, OWNER_0, ownerType: 0x00 });
  return { G: tokenId, AMOUNT_0, OWNER_0, VALUE_0, feeOut, changeSpkLen, transferSPK, stateOut0, consts, wireVersion: 'v2', arms };
}
// re-derive the root from the leaf set and assert it equals the descriptor's transferSPK (the de-circularization gate; HALT on drift).
export function assertLeafCoverage(deploy) {
  const arms = deploy.arms ?? ['key', 'script'];
  const { transferSPK } = buildTaptree(deploy.consts, { arms });
  if (!transferSPK.equals(deploy.transferSPK)) throw new Error('HALT: deploy.transferSPK != the re-derived leaf-set root — under-covered/wrong root (a frozen mint would strand notes)');
  // E-2: the root equality alone is VACUOUS (it re-derives from the same enumerator). Independently assert TOTAL coverage of the
  // reachable tuple space + the exact structural count, so a dropped/extra reachable cell is caught even though out0==root holds.
  const gaps = coverageGaps(enumerateLeaves(deploy.consts, { arms }), { arms });
  if (gaps.length) throw new Error(`HALT: leaf-set coverage incomplete: ${gaps.join(' | ')}`);
  return transferSPK;
}

// When the indexer first finds the G-consuming mint, prove the descriptor matches the chain: it MUST be a genesis template
// AND its out0 SPK must be the DERIVED transferSPK. A mismatch ⟹ wrong descriptor ⟹ HALT (never silent zero-recognition).
export function selfValidateAtGenesis(deploy, genesisTx) {
  if (!isGenesisTemplate(genesisTx, deploy)) throw new Error('HALT: the claimed genesis tx is not the exact mint template for this descriptor');
  if (!genesisTx.outs[0].script.equals(deploy.transferSPK)) throw new Error('HALT: deploy.transferSPK != on-chain genesis out0 SPK — wrong descriptor');
}
