// =============================================================================
//  IsoForge — shared loadout: maps a CLASS to its outfit, and a saved character
//  config to buildCharacter() opts. Used by the creator AND the game scene so the
//  look stays identical between them.
// =============================================================================

// WoW-style: the GEAR identifies the class, not the race.
export const CLASS_OUTFIT = {
  Guerrier:    { style: 'plate',  accent: 0x8a3b2e, trim: 0xb6bcc4, secondary: 0x5a2820, hat: 'none' },
  Paladin:     { style: 'plate',  accent: 0xc9a24a, trim: 0xe8e2d0, secondary: 0x8a6a2a, hat: 'none' },
  Chasseur:    { style: 'straps', accent: 0x4a6a3a, trim: 0x6e5236, secondary: 0x33421f, hat: 'none' },
  Voleur:      { style: 'straps', accent: 0x2e3640, trim: 0x6a6a4a, secondary: 0x1c2028, hat: 'none' },
  'Prêtre':    { style: 'robe',   accent: 0xe6e0cf, trim: 0xc9a23a, secondary: 0xcfc8b0, hat: 'none' },
  Chaman:      { style: 'mail',   accent: 0x3a6a7a, trim: 0xc9a23a, secondary: 0x244650, hat: 'none' },
  Mage:        { style: 'robe',   accent: 0x3a4ec9, trim: 0xc9a23a, secondary: 0x24306e, hat: 'wizard' },
  'Démoniste': { style: 'robe',   accent: 0x5a2e6e, trim: 0x8a3a3a, secondary: 0x3a1e46, hat: 'wizard' },
  Druide:      { style: 'robe',   accent: 0x6a5a2e, trim: 0x4a6a3a, secondary: 0x46401e, hat: 'none' },
};

export const DEFAULT_CHARACTER = {
  faction: 'alliance', race: 'human', cls: 'Guerrier', name: 'Héros',
  hairStyle: null, hairColor: null, skinColor: null, eyeColor: null,
};

// A saved character config -> opts for buildCharacter(race, opts).
export function loadoutOpts(config) {
  const c = config || DEFAULT_CHARACTER;
  const o = CLASS_OUTFIT[c.cls] || CLASS_OUTFIT.Guerrier;
  return {
    accent: o.accent, trim: o.trim, secondary: o.secondary, style: o.style, hat: o.hat,
    hairStyle: c.hairStyle ?? undefined,
    hairColor: c.hairColor ?? undefined,
    skinColor: c.skinColor ?? undefined,
    eyeColor: c.eyeColor ?? undefined,
  };
}

const KEY = 'isoforge.character';

export function saveCharacter(config) {
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch (e) { /* ignore */ }
}

export function loadCharacter() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
