/** Forge tier palette + temperature mapping — shared by gauges, bars, ingots,
    medals and rank flair. Colors are the frozen design tokens (as CSS vars or
    the matching rgba for glows). Never invent colors here. */
export type Tier = 'iron' | 'bronze' | 'silver' | 'gold' | 'ember'

export const TIER: Record<Tier, { rim: string; face: string; glow: string; ink: string }> = {
  iron: { rim: 'var(--color-ink-600)', face: 'var(--color-ink-700)', glow: 'rgba(107,114,128,0)', ink: 'var(--color-text-lo)' },
  bronze: { rim: 'var(--color-forge-700)', face: 'var(--color-forge-600)', glow: 'rgba(178,32,0,0.45)', ink: 'var(--color-forge-50)' },
  silver: { rim: 'var(--color-text-lo)', face: 'var(--color-text-mid)', glow: 'rgba(161,167,179,0.35)', ink: 'var(--color-ink-950)' },
  gold: { rim: 'var(--color-bell-600)', face: 'var(--color-bell-400)', glow: 'rgba(224,168,16,0.5)', ink: 'var(--color-ink-950)' },
  ember: { rim: 'var(--color-forge-500)', face: 'var(--color-forge-400)', glow: 'rgba(255,76,0,0.55)', ink: 'var(--color-ink-950)' },
}

/** Fill-fraction → forge "temperature" (cold-dark → ember → white-hot).
    Shared by gauge/bar/ingot so the heat color is consistent everywhere. */
export function forgeTemp(frac: number) {
  const f = Math.max(0, Math.min(1, frac))
  if (f === 0) return { fill: 'var(--color-forge-700)', glow: 'rgba(178,32,0,0.4)' }
  if (f < 0.34) return { fill: 'var(--color-forge-600)', glow: 'rgba(232,93,4,0.5)' }
  if (f < 0.67) return { fill: 'var(--color-forge-500)', glow: 'rgba(255,76,0,0.6)' }
  if (f < 0.92) return { fill: 'var(--color-forge-400)', glow: 'rgba(255,122,26,0.65)' }
  return { fill: 'var(--color-bell-300)', glow: 'rgba(255,210,74,0.75)' }
}
