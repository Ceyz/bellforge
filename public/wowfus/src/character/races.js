// =============================================================================
//  races.js — COMPAT SHIM. The race data now lives in spec.js (the canonical
//  data layer). This file only re-exports so existing imports keep working:
//
//      import { resolveRace, RACE_KEYS } from './races.js';
//
//  IMPORTANT (back-compat): the LEGACY monolithic buildCharacter reads
//  `race.features` as a flat bag of loose flags (f.hair, f.beard, f.ears, ...).
//  spec.resolveRace returns the new STRUCTURED `features` plus a derived
//  `legacyFeatures`. To avoid breaking the current builder, this shim's
//  resolveRace swaps `features` to the legacy shape. New code should import from
//  spec.js and use the structured `features` + `parts`.
//
//  Migration path: once buildCharacter becomes the thin orchestrator (see
//  docs/PIPELINE_V2.md), delete this shim and import resolveRace from spec.js.
// =============================================================================
import { resolveRace as resolveSpec, RACE_KEYS as KEYS } from './spec.js';

export function resolveRace(key) {
  const r = resolveSpec(key);
  // Present the legacy flat-flag `features` to old consumers while keeping the
  // structured data reachable under `featuresStructured` / `parts` / `colors`.
  return {
    ...r,
    featuresStructured: r.features,
    features: r.legacyFeatures,
  };
}

export const RACE_KEYS = KEYS;

// Re-export the canonical API for code that wants the new layer directly.
export {
  BASE, PROP_FIELDS, PART_CATALOG, INVARIANTS,
  validateRace, assertRace, validateAll, getRaceDef,
} from './spec.js';
