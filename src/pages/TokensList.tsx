import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/app/PageHeader'
import { PageItem } from '../components/ui/PageTransition'
import { StatusPill } from '../components/ui/StatusPill'
import { PixelIcon } from '../components/ui/PixelIcon'
import { HonestBanner } from '../components/ui/HonestBanner'
import { SortHeader } from '../components/ui/SortHeader'
import { Reveal } from '../components/ui/Reveal'
import { SlidingToggle } from '../components/juice/SlidingToggle'
import { MoltenBar } from '../components/juice/MoltenBar'
import { RankFlair } from '../components/juice/RankFlair'
import { TOKEN_LIST, type TokenInfo } from '../lib/tokens'
import { asset } from '../config'

type SortKey = 'newest' | 'holders' | 'minted'
type Dir = 'asc' | 'desc'
type Filter = 'all' | 'native' | 'opcat'

const mintedPct = (t: TokenInfo) => (t.cap && t.cap > 0 ? ((t.minted ?? 0) / t.cap) * 100 : 0)
const isOpcat = (t: TokenInfo) => t.type === 'opcat' && !!t.cap
const holdersText = (t: TokenInfo) => (t.type === 'native' ? '—' : (t.holders ?? 0).toLocaleString())
const mintedText = (t: TokenInfo) => (isOpcat(t) ? `${mintedPct(t).toFixed(0)}%` : '—')
const supplyText = (t: TokenInfo) => (t.cap ? `0 / ${t.cap.toLocaleString()}` : '—')

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'native', label: 'Native' },
  { id: 'opcat', label: 'OP_CAT' },
]

export function TokensList() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [dir, setDir] = useState<Dir>('desc')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = TOKEN_LIST.filter((t) => (filter === 'all' ? true : t.type === filter))
    if (needle) list = list.filter((t) => (t.sym + t.name + t.tag).toLowerCase().includes(needle))
    const base = sort === 'newest' ? [...list].reverse() : [...list]
    if (sort !== 'newest') {
      const val = (t: TokenInfo) => (sort === 'holders' ? t.holders ?? 0 : mintedPct(t))
      base.sort((a, b) => (dir === 'asc' ? val(a) - val(b) : val(b) - val(a)))
    }
    return base
  }, [q, sort, dir, filter])

  const ranked = sort !== 'newest'

  const toggleSort = (k: Exclude<SortKey, 'newest'>) => {
    if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir('desc')
    }
  }

  const MintedCell = ({ t }: { t: TokenInfo }) =>
    isOpcat(t) ? (
      <span className="ml-auto block w-28">
        <MoltenBar pct={mintedPct(t)} tone="forge" label={mintedText(t)} height={5} />
      </span>
    ) : (
      <span className="font-mono text-text-mid">—</span>
    )

  return (
    <>
      <PageItem>
        <PageHeader title="Explore tokens" subtitle="$BELLS, $BOUND and every OP_CAT token on Bellscoin." />
      </PageItem>

      <PageItem>
        <HonestBanner>
          Live holder counts and % minted arrive with the P4 deterministic indexer at mainnet. Today every
          value is <span className="font-mono text-text-hi">0</span> or <span className="font-mono text-text-hi">—</span>, never
          faked. Ranking by these fields is regtest ornament until the indexer lands.
        </HonestBanner>
      </PageItem>

      <PageItem className="my-5 flex flex-wrap items-center justify-between gap-3">
        <SlidingToggle pill options={FILTERS} value={filter} onChange={setFilter} layoutId="pill-token-filter" />
        <label className="relative">
          <span className="sr-only">Search tokens</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="input-forge w-44 rounded-btn border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-text-hi placeholder:text-text-lo"
          />
        </label>
      </PageItem>

      {rows.length === 0 ? (
        <div className="rounded-card border border-ink-600 bg-ink-800/60 p-10 text-center">
          <p className="text-text-mid">No tokens match.</p>
          <button
            type="button"
            onClick={() => {
              setQ('')
              setFilter('all')
            }}
            className="mt-3 text-sm text-forge-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-card border border-ink-600 bg-ink-800/60 sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-600 bg-ink-800 text-left">
                <tr>
                  <th className="w-10 px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-text-lo">#</th>
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-text-lo">Token</th>
                  <th className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-text-lo">Type</th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader label="Holders" active={sort === 'holders'} dir={dir} onClick={() => toggleSort('holders')} />
                  </th>
                  <th className="px-5 py-3 text-right">
                    <SortHeader label="% Minted" active={sort === 'minted'} dir={dir} onClick={() => toggleSort('minted')} />
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-lo">Supply</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-text-lo">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-600">
                {rows.map((t, i) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate(`/app/token/${t.id}`)}
                    className="cursor-pointer transition hover:bg-ink-700/60"
                  >
                    <td className="px-4 py-4 text-center">
                      <RankFlair place={ranked && i < 3 ? ((i + 1) as 1 | 2 | 3) : null} />
                    </td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-2.5">
                        {t.sprite ? (
                          <PixelIcon src={asset(t.sprite)} alt="" native={32} />
                        ) : (
                          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-700 font-mono text-[10px] text-bell-300 ring-1 ring-ink-600">
                            {t.sym.replace('$', '')}
                          </span>
                        )}
                        <span>
                          <Link to={`/app/token/${t.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-text-hi hover:text-forge-400">
                            {t.sym}
                          </Link>
                          <span className="block text-xs text-text-lo">{t.name}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-4 text-text-mid">{t.tag}</td>
                    <td className="px-5 py-4 text-right font-mono text-text-hi">{holdersText(t)}</td>
                    <td className="px-5 py-4 text-right">
                      <MintedCell t={t} />
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-text-mid">{supplyText(t)}</td>
                    <td className="px-5 py-4 text-right">
                      <StatusPill status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {rows.map((t, i) => (
              <Reveal key={t.id} delay={i * 0.04}>
                <Link to={`/app/token/${t.id}`} className="block rounded-card border border-ink-600 bg-ink-800/60 p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2.5">
                      {t.sprite ? (
                        <PixelIcon src={asset(t.sprite)} alt="" native={32} />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-700 font-mono text-[10px] text-bell-300 ring-1 ring-ink-600">
                          {t.sym.replace('$', '')}
                        </span>
                      )}
                      <span>
                        <span className="font-mono text-text-hi">{t.sym}</span>
                        <span className="block text-xs text-text-lo">{t.name}</span>
                      </span>
                    </span>
                    <StatusPill status={t.status} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 items-end gap-3 border-t border-ink-600 pt-3 text-xs">
                    <div>
                      <dt className="text-text-lo">Holders</dt>
                      <dd className="font-mono text-text-hi">{holdersText(t)}</dd>
                    </div>
                    <div>
                      <dt className="text-text-lo">% Minted</dt>
                      <dd>
                        {isOpcat(t) ? (
                          <MoltenBar pct={mintedPct(t)} tone="forge" label={mintedText(t)} height={5} className="w-full" />
                        ) : (
                          <span className="font-mono text-text-hi">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-text-lo">Supply</dt>
                      <dd className="font-mono text-text-mid">{supplyText(t)}</dd>
                    </div>
                  </dl>
                </Link>
              </Reveal>
            ))}
          </div>
        </>
      )}
    </>
  )
}
