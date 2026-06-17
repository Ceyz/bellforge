import { useId, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { SlidingToggle } from '../juice/SlidingToggle'
import { StatusPill } from '../ui/StatusPill'
import { PixelIcon } from '../ui/PixelIcon'
import { TOKEN_LIST, type TokenInfo } from '../../lib/tokens'
import { asset } from '../../config'

type Filter = 'all' | 'opcat' | 'rune'
/** Two ecosystems for the filter, matching the explorer: OP_CAT/native vs Runes. */
const family = (t: TokenInfo): 'opcat' | 'rune' => (t.protocol === 'rune' ? 'rune' : 'opcat')
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'opcat', label: 'OP_CAT' },
  { id: 'rune', label: 'Runes' },
]

/** A searchable, filterable token chooser. Each row carries a Rune / OP_CAT badge
    so the two protocols are never confused. Reuses the explorer's token data. */
export function TokenPicker({ exclude = [], onSelect, onClose }: { exclude?: string[]; onSelect: (t: TokenInfo) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const titleId = useId()

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = TOKEN_LIST.filter((t) => !exclude.includes(t.id))
    list = list.filter((t) => (filter === 'all' ? true : family(t) === filter))
    if (needle) list = list.filter((t) => (t.sym + t.name + t.tag).toLowerCase().includes(needle))
    return list
  }, [q, filter, exclude])

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 id={titleId} className="font-display text-lg text-text-hi">Select a token</h4>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-lo transition hover:text-text-hi">
            ✕
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or symbol…"
          autoFocus
          className="input-forge mb-3 w-full rounded-btn border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-text-hi outline-none placeholder:text-text-lo focus:border-forge-400"
        />
        <SlidingToggle pill options={FILTERS} value={filter} onChange={setFilter} layoutId="pill-swap-token-filter" className="mb-3" />

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-lo">No tokens match.</p>
          ) : (
            rows.map((t) => {
              const fam = family(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t)}
                  className="flex w-full items-center gap-3 rounded-btn border border-ink-600 bg-ink-800 px-3 py-2.5 text-left transition hover:border-forge-400"
                >
                  {t.sprite ? (
                    <PixelIcon src={asset(t.sprite)} alt="" native={28} />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-700 font-mono text-[9px] text-bell-300 ring-1 ring-ink-600">
                      {t.sym.replace(/[$•]/g, '').slice(0, 4)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-sm text-text-hi">{t.sym}</span>
                    <span className="block truncate text-xs text-text-lo">{t.name}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-pill px-2 py-0.5 font-micro text-[9px] uppercase tracking-wide ring-1 ${
                      fam === 'rune' ? 'bg-rune-500/15 text-rune-300 ring-rune-500/30' : 'bg-forge-500/15 text-forge-300 ring-forge-500/30'
                    }`}
                  >
                    {fam === 'rune' ? 'Rune' : 'OP_CAT'}
                  </span>
                  <StatusPill status={t.status} />
                </button>
              )
            })
          )}
        </div>
    </Modal>
  )
}
