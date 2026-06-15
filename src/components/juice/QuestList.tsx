import { motion, useReducedMotion } from 'motion/react'
import type { Quest } from '../../lib/forge-progress'

/** Staggered quest checklist. Each row: a check rune (✓ done / ○ todo), the title,
    and the literal evidence (done) or hint (todo) — all from verifiable facts. */
export function QuestList({ quests }: { quests: Quest[] }) {
  const reduce = useReducedMotion()
  return (
    <ul className="space-y-2">
      {quests.map((q, i) => (
        <motion.li
          key={q.id}
          initial={reduce ? false : { opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-start gap-3"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
              q.done ? 'bg-forge-500/20 text-forge-300 ring-1 ring-forge-500/40' : 'bg-ink-700 text-text-lo ring-1 ring-ink-600'
            }`}
          >
            {q.done ? '✓' : '○'}
          </span>
          <span>
            <span className={`text-sm font-medium ${q.done ? 'text-text-hi' : 'text-text-mid'}`}>{q.title}</span>
            <span className="block text-xs text-text-lo">{q.done ? q.evidence : q.hint}</span>
          </span>
        </motion.li>
      ))}
    </ul>
  )
}
