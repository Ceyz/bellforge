import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Medal } from './Medal'
import { SparkBurst } from './SparkBurst'
import type { Tier } from './tiers'
import type { Quest } from '../../lib/forge-progress'

const QUEST_TIER: Record<string, Tier> = {
  connect: 'bronze',
  fund: 'bronze',
  explore: 'silver',
  deploy: 'gold',
  mint: 'ember',
}

/** Achievement shelf: one medal per quest (locked until its quest completes).
    Fires a spark burst when a new medal unlocks. */
export function MedalShelf({ quests }: { quests: Quest[] }) {
  const reduce = useReducedMotion()
  const done = quests.filter((q) => q.done).length
  const prev = useRef(done)
  const [fire, setFire] = useState(0)
  useEffect(() => {
    if (done > prev.current && !reduce) setFire((n) => n + 1)
    prev.current = done
  }, [done, reduce])
  return (
    <div className="relative flex flex-wrap items-center gap-3">
      {quests.map((q) => (
        <motion.div
          key={q.id}
          initial={false}
          animate={q.done && !reduce ? { scale: [1, 1.18, 1] } : { scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <Medal tier={QUEST_TIER[q.id] ?? 'bronze'} locked={!q.done} size={38} label={`${q.title}${q.done ? '' : ' (locked)'}`} />
        </motion.div>
      ))}
      <SparkBurst fire={fire} count={12} originX={50} originY={50} spread={1} />
    </div>
  )
}
