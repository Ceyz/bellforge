import { useEffect, useRef, useState } from 'react'

const ORDER = ['Cold Iron', 'Apprentice', 'Smith', 'Forgemaster', 'Grandmaster']

/** Detects a rank-name INCREASE (skipping the first resolve so a fresh mount or a
    reconnect never falsely celebrates). Returns { celebrate, clear }. */
export function useLevelUp(rankName: string) {
  const prev = useRef<number | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    const idx = ORDER.indexOf(rankName)
    if (idx < 0) return
    if (prev.current !== null && idx > prev.current) setCelebrate(true)
    prev.current = idx
  }, [rankName])
  return { celebrate, clear: () => setCelebrate(false) }
}
