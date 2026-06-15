import { TIER } from './tiers'

/** Honest leaderboard ornament: a gold/silver/bronze chip for the top 3 rows —
    ONLY rendered when the explorer is actually sorted by a real metric. The
    numbers stay the existing honest 0/—; flair is pure positional ornament.
    place=null → a neutral dot. */
const MAP = { 1: 'gold', 2: 'silver', 3: 'bronze' } as const

export function RankFlair({ place }: { place: 1 | 2 | 3 | null }) {
  if (place == null) return <span className="text-text-lo">·</span>
  const t = TIER[MAP[place]]
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-md font-micro text-[10px]"
      style={{ background: t.face, color: t.ink, boxShadow: `0 0 8px ${t.glow}` }}
      title={`Rank #${place} by this metric (regtest)`}
    >
      {place}
    </span>
  )
}
