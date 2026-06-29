// =============================================================================
//  IsoForge — Character SPEC (the canonical data layer)
// -----------------------------------------------------------------------------
//  A race is ONLY DATA. Adding a new playable race must be a new row in RACES —
//  never new code. This module owns:
//
//    1. BASE proportions           (the human chibi reference, in metres)
//    2. The RACE SCHEMA            (multipliers + identity + features + parts)
//    3. resolveRace(key)           -> flat { key, label, prop, colors, features, parts, ... }
//    4. validateRace(spec|key)     -> data-driven invariants & range checks
//
//  The BUILDER (buildCharacter.js) and the part generators (head/body/extremities)
//  consume the resolved object; they never read RACES directly. Same spec in ->
//  same character out.
//
//  BACK-COMPAT: the resolved object still exposes the legacy flat fields
//  (`skin`, `hair`, `features` as loose flags) so the current monolithic
//  buildCharacter keeps working unchanged during the migration. New code should
//  read `colors`, `features` (structured) and `parts`.
// =============================================================================

// -----------------------------------------------------------------------------
//  1. BASE — bone segment lengths + silhouette thicknesses (human chibi reference)
//     Every race derives from this by per-field multipliers. Units: metres.
// -----------------------------------------------------------------------------
export const BASE = {
  // bone segment lengths
  neckLen: 0.03, pelvisH: 0.08, spineLen: 0.14, chestLen: 0.16,
  shoulderX: 0.16, upperArm: 0.16, foreArm: 0.15, handSize: 0.11,
  hipX: 0.085, thigh: 0.17, shin: 0.16, footH: 0.10, footLen: 0.27,
  // silhouette
  headSize: 0.42, headDepth: 0.40, armThick: 0.10, legThick: 0.13,
  torsoW: 0.36, torsoD: 0.24,
};

// The full, ordered list of proportion fields the rig + generators rely on.
// Used by validateRace to guarantee a race never produces an undefined field.
export const PROP_FIELDS = Object.keys(BASE);

// -----------------------------------------------------------------------------
//  PART CATALOGUE — the legal values for each part selector.
//  Generators (head.js / body.js / extremities.js) switch on these strings.
//  Adding a new style = add a string here + handle it in the owning generator.
//  Keeping the catalogue here means validateRace can reject typos in data.
// -----------------------------------------------------------------------------
export const PART_CATALOG = {
  headShape: ['round', 'broad', 'long', 'square'], // skull silhouette family
  hairStyle: ['none', 'short', 'long', 'mohawk', 'topknot', 'bald'],
  beardStyle: ['none', 'short', 'braided', 'long', 'stubble'],
  earType: ['round', 'pointed', 'long', 'droopy'],
  noseType: ['normal', 'big', 'flat', 'hooked'],
  browType: ['none', 'soft', 'heavy'],
  tuskType: ['none', 'lower', 'upper'],
  shoeStyle: ['boot', 'sandal', 'barefoot', 'plate'],
  handStyle: ['normal', 'broad', 'clawed'],
  hatStyle: ['none', 'wizard', 'circlet', 'horned'],
};

// -----------------------------------------------------------------------------
//  2. RACE SCHEMA
//
//  Each race row is pure data with FOUR groups:
//    mul      : sparse proportion multipliers over BASE (missing => 1.0)
//    colors   : identity palette (skin / hair / eye iris / accents)
//    features : toggles + their params (the "what does it have" layer)
//    parts    : selectors -> which generator STYLE fills each slot
//
//  features vs parts:
//    - `parts` decides the GEOMETRY FAMILY a generator builds (a data switch).
//    - `features` decides WHETHER an optional add-on exists and tunes it.
//    Races mix-and-match freely: e.g. an orc can take parts.headShape:'broad'
//    with features.tusks while a goblin reuses parts.earType:'long'.
// -----------------------------------------------------------------------------
const RACES = {
  // --- HUMAN — the balanced reference silhouette ---------------------------
  human: {
    label: 'Humain',
    mul: {},
    colors: { skin: 0xe2a17c, hair: 0x5a3d28, iris: 0x8a5a30 },
    features: {
      hat: { style: 'wizard' },
    },
    parts: {
      headShape: 'round', hairStyle: 'short', beardStyle: 'none',
      earType: 'round', noseType: 'normal', browType: 'soft',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'wizard',
    },
  },

  // --- DWARF — SHORT and WIDE: tiny legs, huge torso, big head, big beard ---
  dwarf: {
    label: 'Nain',
    mul: {
      headSize: 1.1, headDepth: 1.04, torsoW: 1.32, torsoD: 1.28,
      spineLen: 0.85, chestLen: 0.85, shoulderX: 1.6, hipX: 1.2,
      thigh: 0.68, shin: 0.66, legThick: 1.32, footLen: 0.98, footH: 1.0,
      upperArm: 0.82, foreArm: 0.82, armThick: 1.4, handSize: 1.12,
    },
    colors: { skin: 0xd49a72, hair: 0x553521, beard: 0xb5703a, iris: 0x5e3d22 },
    features: {
      beard: { color: 0xb5703a, braided: true },
      bigNose: true,
      brows: true,
    },
    parts: {
      headShape: 'broad', hairStyle: 'short', beardStyle: 'braided',
      earType: 'round', noseType: 'big', browType: 'heavy',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'broad', hatStyle: 'none',
    },
  },

  // --- ELF — TALL and SLENDER: long limbs, long pointed ears, long hair -----
  elf: {
    label: 'Elfe',
    mul: {
      headSize: 0.9, headDepth: 0.92, torsoW: 0.82, torsoD: 0.92,
      spineLen: 1.2, chestLen: 1.25, shoulderX: 0.9,
      thigh: 1.5, shin: 1.5, legThick: 0.78, footLen: 0.92,
      upperArm: 1.4, foreArm: 1.35, armThick: 0.78, handSize: 0.92,
    },
    colors: { skin: 0xdfe0cf, hair: 0x2c2c38, iris: 0x46cdb2, accent: 0x36d8c6 },
    features: {
      ears: true,
      circlet: true,
      tattoos: { color: 0x36d8c6 },
      armBand: { color: 0x36d8c6 },
      eye: { almond: true },
    },
    parts: {
      headShape: 'long', hairStyle: 'long', beardStyle: 'none',
      earType: 'long', noseType: 'normal', browType: 'soft',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'circlet',
    },
  },

  // --- ORC — bulky and hunched, green, tusks --------------------------------
  orc: {
    label: 'Orc',
    mul: {
      headSize: 1.05, headDepth: 1.0, torsoW: 1.4, torsoD: 1.25,
      shoulderX: 1.45, hipX: 1.1, thigh: 0.92, legThick: 1.45,
      upperArm: 1.1, foreArm: 1.05, armThick: 1.5, handSize: 1.25,
      footLen: 1.05, footH: 1.05,
    },
    colors: { skin: 0x7aa258, hair: 0x2b2b22, iris: 0xc25a2a },
    features: {
      tusks: true,
      brows: true,
    },
    parts: {
      headShape: 'broad', hairStyle: 'topknot', beardStyle: 'none',
      earType: 'pointed', noseType: 'flat', browType: 'heavy',
      tuskType: 'lower', shoeStyle: 'boot', handStyle: 'broad', hatStyle: 'none',
    },
  },

  // --- GNOME — the SMALLEST race: tiny body, big head, big nose, pointy hat ---
  gnome: {
    label: 'Gnome',
    mul: {
      headSize: 1.1, headDepth: 1.08, torsoW: 0.86, torsoD: 0.9,
      spineLen: 0.75, chestLen: 0.75, shoulderX: 0.9, hipX: 0.92,
      thigh: 0.48, shin: 0.48, legThick: 0.85, footLen: 0.92, footH: 0.85,
      upperArm: 0.76, foreArm: 0.76, armThick: 0.88, handSize: 1.0,
    },
    colors: { skin: 0xeab896, hair: 0xb24a86, iris: 0x4a86c8 },
    features: {
      bigNose: true,
      brows: true,
      hat: { style: 'wizard' },
    },
    parts: {
      headShape: 'round', hairStyle: 'short', beardStyle: 'none',
      earType: 'round', noseType: 'big', browType: 'soft',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'wizard',
    },
  },

  // --- GOBLIN — small, green, long ears, hooked nose, heavy brow -------------
  goblin: {
    label: 'Gobelin',
    mul: {
      headSize: 1.1, headDepth: 1.0, torsoW: 0.86, torsoD: 0.9,
      spineLen: 0.9, chestLen: 0.9, shoulderX: 0.96, hipX: 0.95,
      thigh: 0.72, shin: 0.72, legThick: 0.86, footLen: 1.0,
      upperArm: 0.92, foreArm: 0.98, armThick: 0.86, handSize: 1.05,
    },
    colors: { skin: 0x8fae5a, hair: 0x33331f, iris: 0xd1b23a },
    features: {
      ears: true,
      brows: true,
    },
    parts: {
      headShape: 'broad', hairStyle: 'short', beardStyle: 'none',
      earType: 'long', noseType: 'hooked', browType: 'heavy',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'none',
    },
  },

  // --- TAUREN — the BIGGEST race: massive, horned, broad muzzle (Horde) ------
  tauren: {
    label: 'Tauren',
    mul: {
      headSize: 1.15, headDepth: 1.18, torsoW: 1.5, torsoD: 1.35,
      spineLen: 1.05, chestLen: 1.1, shoulderX: 1.55, hipX: 1.25,
      thigh: 1.05, shin: 1.0, legThick: 1.55, footLen: 1.15, footH: 1.1,
      upperArm: 1.2, foreArm: 1.15, armThick: 1.6, handSize: 1.3,
    },
    colors: { skin: 0x8a6a4a, hair: 0x4a3322, iris: 0x2a1c12 },
    features: {
      horns: true,
      bigNose: true,
      brows: true,
    },
    parts: {
      headShape: 'broad', hairStyle: 'short', beardStyle: 'none',
      earType: 'round', noseType: 'flat', browType: 'heavy',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'broad', hatStyle: 'none',
    },
  },

  // --- TROLL — tall & lanky: long limbs, tusks, mohawk, big feet (Horde) -----
  troll: {
    label: 'Troll',
    mul: {
      headSize: 0.95, headDepth: 1.1, torsoW: 0.85, torsoD: 0.95,
      spineLen: 1.2, chestLen: 1.15, shoulderX: 1.0, hipX: 0.95,
      thigh: 1.55, shin: 1.55, legThick: 0.85, footLen: 1.2, footH: 1.0,
      upperArm: 1.5, foreArm: 1.5, armThick: 0.9, handSize: 1.2,
    },
    colors: { skin: 0x5a8a7a, hair: 0xb23a3a, iris: 0xd1b23a },
    features: {
      tusks: true,
      brows: true,
    },
    parts: {
      headShape: 'long', hairStyle: 'mohawk', beardStyle: 'none',
      earType: 'pointed', noseType: 'hooked', browType: 'heavy',
      tuskType: 'lower', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'none',
    },
  },

  // --- UNDEAD (Forsaken) — gaunt, pale grey-green, sunken glowing eyes (Horde)
  undead: {
    label: 'Mort-vivant',
    mul: {
      headSize: 0.98, headDepth: 0.95, torsoW: 0.8, torsoD: 0.8,
      spineLen: 1.05, chestLen: 1.0, shoulderX: 0.95, hipX: 0.95,
      thigh: 1.08, shin: 1.08, legThick: 0.74, footLen: 1.0, footH: 1.0,
      upperArm: 1.08, foreArm: 1.08, armThick: 0.72, handSize: 1.0,
    },
    colors: { skin: 0x9fb0a2, hair: 0x2c2c30, iris: 0xbfe8d4 },
    features: {
      brows: true,
      eye: { glow: true },
    },
    parts: {
      headShape: 'long', hairStyle: 'short', beardStyle: 'none',
      earType: 'round', noseType: 'normal', browType: 'heavy',
      tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'none',
    },
  },
};

// -----------------------------------------------------------------------------
//  INVARIANT RULES — DATA, not hardcoded ifs.
//  Each rule is checked by validateRace. Adding a race only means filling the
//  schema; adding a new *constraint* means one row here, applied to ALL races.
//
//  Rule kinds:
//    requireFeature : a named race MUST have a truthy feature (or part != 'none')
//    range          : a proportion field must stay within [min,max] multiplier
//                     of BASE (the "silhouette law" guard rails)
//    partEnum       : every parts.<slot> value must be in PART_CATALOG[slot]
//                     (this one is global, applied to every race automatically)
// -----------------------------------------------------------------------------
export const INVARIANTS = {
  // Per-race "must have" identity locks. Keyed by race key.
  // value: list of { feature?, part?, msg } — at least one of feature/part.
  requireFeature: {
    elf: [
      { part: 'earType', notOneOf: ['round'], msg: 'elf MUST have non-round ears' },
    ],
    dwarf: [
      { feature: 'beard', msg: 'dwarf MUST have a beard' },
      { part: 'beardStyle', notOneOf: ['none', 'stubble'], msg: 'dwarf beard must be full' },
    ],
    orc: [
      { feature: 'tusks', msg: 'orc MUST have tusks' },
    ],
  },

  // Global proportion guard rails: multiplier of BASE must stay inside [min,max].
  // Keeps every race inside the chibi style bible (head 28-43% etc.). Applied to
  // ALL races; a new race that breaks a band is rejected at load.
  range: {
    headSize:  [0.8, 1.25],
    torsoW:    [0.7, 1.6],
    torsoD:    [0.7, 1.6],
    thigh:     [0.45, 1.6],
    shin:      [0.45, 1.6],
    upperArm:  [0.7, 1.6],
    foreArm:   [0.7, 1.6],
    legThick:  [0.7, 1.6],
    armThick:  [0.7, 1.6],
    handSize:  [0.8, 1.4],
    footLen:   [0.8, 1.2],
  },
};

// =============================================================================
//  3. resolveRace(key) -> flat resolved object
// =============================================================================
export function resolveRace(key) {
  const r = RACES[key];
  if (!r) throw new Error('unknown race: ' + key);

  // Resolve proportions: BASE * sparse multipliers.
  const prop = { ...BASE };
  const mul = r.mul || {};
  for (const k in mul) {
    if (!(k in BASE)) throw new Error(`race '${key}' multiplies unknown prop '${k}'`);
    prop[k] = BASE[k] * mul[k];
  }

  const colors = { ...(r.colors || {}) };
  const features = { ...(r.features || {}) };
  const parts = { ...defaultParts(), ...(r.parts || {}) };

  // Build the resolved object. The new structured layers are the source of
  // truth; the legacy flat fields are derived from them for back-compat.
  const resolved = {
    key,
    label: r.label,
    prop,
    colors,
    features,
    parts,

    // ---- LEGACY mirror (so the current buildCharacter keeps working) -------
    // Old code reads: race.skin, race.hair, race.features.{hair,beard,ears,...}
    skin: colors.skin,
    hair: colors.hair,
  };

  // Mirror structured features back into the loose-flag shape the monolithic
  // builder still expects. This bridge is removed once buildCharacter is the
  // thin orchestrator described in PIPELINE_V2.md.
  resolved.legacyFeatures = toLegacyFeatures(resolved);

  return resolved;
}

// Default part selectors — a race that omits a slot still resolves to something
// sane (a plain human part). Keeps "new race in pure data" truly minimal.
function defaultParts() {
  return {
    headShape: 'round', hairStyle: 'short', beardStyle: 'none',
    earType: 'round', noseType: 'normal', browType: 'soft',
    tuskType: 'none', shoeStyle: 'boot', handStyle: 'normal', hatStyle: 'none',
  };
}

// Derive the legacy loose-flag `features` object from the structured spec so the
// existing monolithic buildCharacter renders BYTE-IDENTICALLY. (Bridge — see above.)
//
// NOTE: this mirrors EXPLICIT `features` toggles only. It deliberately does NOT
// derive flags from `parts.*` selectors — `parts` drives the NEW generators
// (head/body/extremities), which the legacy builder does not call. Mixing the
// two would, e.g., turn the orc's parts.earType:'pointed' into the elf cone-ear
// geometry the old builder draws for `f.ears`. Hair is the one exception: the
// legacy builder keys hair off the style string, which lives in parts.hairStyle.
function toLegacyFeatures(R) {
  const f = R.features;
  const p = R.parts;
  const out = {};

  // hair: legacy expects 'short' | 'long' (truthy gate). Sourced from the part
  // selector because the legacy builder needs the style word, not a toggle.
  if (p.hairStyle && p.hairStyle !== 'none' && p.hairStyle !== 'bald') {
    out.hair = p.hairStyle === 'long' ? 'long' : 'short';
  }
  // beard: legacy expects a colour number (truthy)
  if (f.beard) out.beard = f.beard.color ?? R.colors.beard ?? R.colors.hair;
  if (f.beard && f.beard.braided) out.braided = true;
  // simple toggles — explicit features only
  if (f.bigNose) out.bigNose = true;
  if (f.brows) out.brows = true;
  if (f.ears) out.ears = true;
  if (f.tusks) out.tusks = true;
  if (f.horns) out.horns = true;
  if (f.circlet) out.circlet = true;
  if (f.armBand) out.armBand = true;
  if (f.tattoos) out.tattoos = f.tattoos.color ?? R.colors.accent;
  // eye: legacy expects { iris, almond? }
  out.eye = { iris: R.colors.iris ?? 0x4a3526, ...(f.eye || {}) };
  // hat: legacy expects a style string
  if (f.hat && f.hat.style) out.hat = f.hat.style;

  return out;
}

// =============================================================================
//  4. validateRace — data-driven invariants + range checks
//     Pass a race KEY or a resolved object. Returns { ok, issues:[] }.
//     Throws only on a hard structural error (unknown key). Soft violations are
//     reported in `issues` and (optionally) thrown via assertRace().
// =============================================================================
export function validateRace(spec) {
  const R = typeof spec === 'string' ? resolveRace(spec) : spec;
  const issues = [];
  const key = R.key;

  // (a) every proportion field must be a finite positive number
  for (const field of PROP_FIELDS) {
    const v = R.prop[field];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
      issues.push(`prop.${field} is not a positive number (${v})`);
    }
  }

  // (b) global range guard rails (silhouette law)
  for (const field in INVARIANTS.range) {
    const [lo, hi] = INVARIANTS.range[field];
    const ratio = R.prop[field] / BASE[field];
    if (ratio < lo - 1e-6 || ratio > hi + 1e-6) {
      issues.push(
        `prop.${field} ratio ${ratio.toFixed(2)} out of range [${lo}, ${hi}]`);
    }
  }

  // (c) every part selector must name a known style
  for (const slot in R.parts) {
    const legal = PART_CATALOG[slot];
    if (!legal) { issues.push(`unknown part slot '${slot}'`); continue; }
    if (!legal.includes(R.parts[slot])) {
      issues.push(`parts.${slot}='${R.parts[slot]}' not in [${legal.join(', ')}]`);
    }
  }

  // (d) per-race identity invariants (the data rules table)
  const rules = INVARIANTS.requireFeature[key] || [];
  for (const rule of rules) {
    let ok = true;
    if (rule.feature) ok = !!R.features[rule.feature];
    if (ok && rule.part) {
      const val = R.parts[rule.part];
      if (rule.notOneOf) ok = !rule.notOneOf.includes(val);
      else if (rule.oneOf) ok = rule.oneOf.includes(val);
      else ok = val != null && val !== 'none';
    }
    if (!ok) issues.push(rule.msg || `invariant failed for ${key}`);
  }

  return { ok: issues.length === 0, issues, key };
}

// Throwing variant — handy in tests / CI ("schema valid" gate).
export function assertRace(spec) {
  const { ok, issues, key } = validateRace(spec);
  if (!ok) throw new Error(`race '${key}' invalid:\n  - ` + issues.join('\n  - '));
  return true;
}

// Validate every registered race at once (the load-time gate).
export function validateAll() {
  const report = {};
  for (const key of RACE_KEYS) report[key] = validateRace(key);
  return report;
}

// -----------------------------------------------------------------------------
//  Registry helpers
// -----------------------------------------------------------------------------
export const RACE_KEYS = Object.keys(RACES);
export function getRaceDef(key) { return RACES[key]; }
