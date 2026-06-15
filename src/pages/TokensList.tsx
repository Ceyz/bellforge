import { Link } from 'react-router-dom'
import { PageHeader } from '../components/app/PageHeader'
import { StatusPill } from '../components/ui/StatusPill'
import { PixelIcon } from '../components/ui/PixelIcon'
import { Reveal } from '../components/ui/Reveal'
import { TOKEN_LIST } from '../lib/tokens'
import { asset } from '../config'

export function TokensList() {
  return (
    <>
      <PageHeader title="Tokens" subtitle="$BELLS, $BOUND and every OP_CAT token on Bellscoin." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOKEN_LIST.map((t, i) => (
          <Reveal key={t.id} delay={i * 0.06} className="h-full">
            <Link to={`/app/token/${t.id}`} className="block h-full">
              <div className="flex h-full flex-col rounded-card border border-ink-600 bg-ink-800/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-forge-500/40 hover:shadow-[0_0_34px_-10px_rgba(255,76,0,0.45)]">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2.5">
                    {t.sprite ? (
                      <PixelIcon src={asset(t.sprite)} alt="" native={40} />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-700 font-mono text-[11px] text-bell-300 ring-1 ring-ink-600">
                        {t.sym.replace('$', '')}
                      </span>
                    )}
                    <span className="font-mono text-base text-text-hi">{t.sym}</span>
                  </span>
                  <StatusPill status={t.status} />
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-text-mid">{t.blurb}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-forge-400">
                  View {t.sym} →
                </span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </>
  )
}
