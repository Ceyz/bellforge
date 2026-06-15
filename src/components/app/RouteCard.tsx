import { motion, useReducedMotion } from 'motion/react'
import { StatusPill, type Status } from '../ui/StatusPill'
import type { RouteId } from '../../lib/routing'

export function RouteCard({
  id,
  title,
  status,
  price,
  slippage,
  note,
  selected,
  disabled,
  onSelect,
}: {
  id: RouteId
  title: string
  status: Status
  price?: string
  slippage?: string
  note?: string
  selected: boolean
  disabled?: boolean
  onSelect: (id: RouteId) => void
}) {
  const reduce = useReducedMotion()
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      whileTap={reduce || disabled ? undefined : { scale: 0.98 }}
      onClick={() => {
        if (!disabled) onSelect(id)
      }}
      title={disabled ? 'Pool route is in R&D — available after mainnet.' : undefined}
      className={`rounded-btn border p-4 text-left transition ${
        selected ? 'border-forge-500 ring-2 ring-forge-500' : 'border-ink-600 hover:border-ink-500'
      } ${disabled ? 'cursor-not-allowed bg-ink-800/40' : 'bg-ink-700/40'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${disabled ? 'text-text-mid' : 'text-text-hi'}`}>{title}</span>
        <StatusPill status={status} />
      </div>
      {note ? (
        <p className="mt-3 text-xs leading-relaxed text-text-lo">{note}</p>
      ) : (
        <dl className="mt-3 space-y-1 font-mono text-xs">
          <div className="flex justify-between">
            <dt className="text-text-lo">Est. price</dt>
            <dd className="text-text-hi">{price}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-lo">Slippage</dt>
            <dd className="text-text-hi">{slippage}</dd>
          </div>
        </dl>
      )}
      {selected && !disabled && <p className="mt-2 text-[11px] font-medium text-forge-400">✓ Best execution</p>}
    </motion.button>
  )
}
