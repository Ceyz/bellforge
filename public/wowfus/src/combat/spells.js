// =============================================================================
//  IsoForge — spell catalogue. Distances are MANHATTAN (|di|+|dj|), matching the
//  4-directional board. `aoe` is a Manhattan radius around the impact cell
//  (0 = single target). Self spells use range [0,0] and target the caster.
//
//  Presentation / mechanics fields (consumed by game.js + vfx.js):
//    fx   : visual archetype — 'fire'|'frost'|'shadow'|'holy'|'nature'|'arcane'
//           |'lightning'|'chain'|'arrow'|'arrowVolley'|'blades'|'slash'|'stab'
//           |'holyHammer'|'healHoly'|'healNature'
//    cast : caster animation pose — 'cast'|'shoot'|'raise'|'melee'|'spin'
//    selfCenter : point-blank AoE centred on the CASTER (no target picking; the
//                 spell fires the instant it is selected). `aoe` = Manhattan radius.
//    chain : { jumps, radius, falloff } — the bolt leaps from foe to foe.
// =============================================================================

export const SPELLS = {
  // --- melee strikes (no line-of-sight needed) ---
  heroic_strike: { name: 'Frappe héroïque',     pa: 3, range: [1, 1], aoe: 0, kind: 'damage', power: 6, color: 0xe8d28a, los: false, fx: 'slash', cast: 'melee' },
  cleave:        { name: 'Coup tournoyant',     pa: 4, range: [1, 1], aoe: 1, kind: 'damage', power: 4, color: 0xe89a3a, los: false, fx: 'slash', cast: 'melee' },
  backstab:      { name: 'Coup bas',            pa: 3, range: [1, 1], aoe: 0, kind: 'damage', power: 7, color: 0xb6d04a, los: false, fx: 'stab',  cast: 'melee' },
  // Fan of Knives — a PBAoE: the rogue SPINS and flings blades at everything around.
  fan_of_knives: { name: 'Éventail de couteaux', pa: 4, range: [0, 0], aoe: 2, kind: 'damage', power: 3, color: 0xcfd6e0, los: false, fx: 'blades', cast: 'spin', selfCenter: true },

  // --- ranged damage ---
  aimed_shot:     { name: 'Tir précis',       pa: 4, range: [2, 7], aoe: 0, kind: 'damage', power: 7, color: 0xa8d06a, los: true, fx: 'arrow',       cast: 'shoot' },
  multishot:      { name: 'Tir multiple',     pa: 4, range: [2, 6], aoe: 1, kind: 'damage', power: 4, color: 0x88b84a, los: true, fx: 'arrowVolley', cast: 'shoot' },
  fireball:       { name: 'Boule de feu',     pa: 4, range: [1, 7], aoe: 1, kind: 'damage', power: 5, color: 0xff7a2a, los: true, fx: 'fire',        cast: 'cast' },
  frostbolt:      { name: 'Trait de givre',   pa: 3, range: [1, 6], aoe: 0, kind: 'damage', power: 5, color: 0x6fd0ff, los: true, fx: 'frost',       cast: 'cast' },
  shadow_bolt:    { name: "Trait de l'ombre", pa: 3, range: [1, 6], aoe: 0, kind: 'damage', power: 5, color: 0x9a4ed0, los: true, fx: 'shadow',      cast: 'cast' },
  immolate:       { name: 'Immolation',       pa: 4, range: [1, 6], aoe: 1, kind: 'damage', power: 4, color: 0xff5a2a, los: true, fx: 'fire',        cast: 'cast', linger: 'fire' },
  lightning_bolt: { name: 'Éclair',           pa: 3, range: [1, 6], aoe: 0, kind: 'damage', power: 5, color: 0x7ad8ff, los: true, fx: 'lightning',   cast: 'cast' },
  chain_lightning:{ name: "Chaîne d'éclairs", pa: 5, range: [1, 6], aoe: 0, kind: 'damage', power: 4, color: 0x9fe0ff, los: true, fx: 'chain',       cast: 'cast', chain: { jumps: 2, radius: 3, falloff: 0.65 } },
  judgment:       { name: 'Jugement',         pa: 3, range: [1, 4], aoe: 0, kind: 'damage', power: 5, color: 0xffe08a, los: true, fx: 'holyHammer',  cast: 'raise' },
  smite:          { name: 'Châtiment',        pa: 3, range: [1, 6], aoe: 0, kind: 'damage', power: 4, color: 0xfff0b0, los: true, fx: 'holy',        cast: 'cast' },
  wrath:          { name: 'Courroux',         pa: 3, range: [1, 6], aoe: 0, kind: 'damage', power: 4, color: 0xa6e06a, los: true, fx: 'nature',      cast: 'cast' },

  // --- heals (cast on self) ---
  holy_light:   { name: 'Lumière sacrée', pa: 4, range: [0, 0], aoe: 0, kind: 'heal', power: 8, color: 0xffe9a8, self: true, fx: 'healHoly',   cast: 'raise' },
  heal:         { name: 'Soin',           pa: 4, range: [0, 0], aoe: 0, kind: 'heal', power: 8, color: 0xfff2c8, self: true, fx: 'healHoly',   cast: 'raise' },
  healing_wave: { name: 'Vague de soins', pa: 4, range: [0, 0], aoe: 0, kind: 'heal', power: 7, color: 0x8ad0c0, self: true, fx: 'healNature', cast: 'raise' },
  rejuvenation: { name: 'Récupération',   pa: 3, range: [0, 0], aoe: 0, kind: 'heal', power: 6, color: 0x9ad06a, self: true, fx: 'healNature', cast: 'raise' },
};

// Each class gets a small kit: a primary attack + a secondary (AoE / heal).
export const CLASS_SPELLS = {
  Guerrier:    ['heroic_strike', 'cleave'],
  Paladin:     ['judgment', 'holy_light'],
  Chasseur:    ['aimed_shot', 'multishot'],
  Voleur:      ['backstab', 'fan_of_knives'],
  'Prêtre':    ['smite', 'heal'],
  Chaman:      ['lightning_bolt', 'chain_lightning', 'healing_wave'],
  Mage:        ['frostbolt', 'fireball'],
  'Démoniste': ['shadow_bolt', 'immolate'],
  Druide:      ['wrath', 'rejuvenation'],
};

export function spellsFor(cls) {
  return (CLASS_SPELLS[cls] || CLASS_SPELLS.Guerrier).map((id) => ({ id, ...SPELLS[id] }));
}
