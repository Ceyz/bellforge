type Dir = 'asc' | 'desc'

/** Sortable column header button. Arrow rotates via CSS only (no motion lib). */
export function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'right',
}: {
  label: string
  active: boolean
  dir: Dir
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition ${
        active ? 'text-text-hi' : 'text-text-lo hover:text-text-mid'
      } ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      {label}
      <span
        className={`transition-transform duration-200 ${active && dir === 'asc' ? 'rotate-180' : ''} ${
          active ? 'text-forge-400 opacity-100' : 'opacity-0'
        }`}
      >
        ↓
      </span>
    </button>
  )
}
