import { Link } from 'react-router-dom'
import { Crucible } from './Crucible'

/** Forge-themed empty state: a small forge glyph (gentle float), an HONEST title +
    one-line reason, and an ember CTA. The "mold" variant is an empty molten mold
    ready to fill — honest by metaphor. */
function Glyph({ icon }: { icon: 'anvil' | 'mold' | 'crucible' }) {
  if (icon === 'crucible') return <Crucible size={92} />
  if (icon === 'mold')
    return (
      <span className="crucible-bob relative inline-block" style={{ width: 84, height: 84 }}>
        <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
          <rect x="14" y="34" width="72" height="34" rx="5" fill="var(--color-ink-700)" stroke="var(--color-ink-600)" strokeWidth="2" />
          <path d="M28 44 h44 l-6 14 h-32 z" fill="var(--color-ink-900)" />
          <path d="M28 44 h44 l-6 14 h-32 z" fill="none" stroke="var(--color-forge-500)" strokeOpacity="0.7" strokeWidth="1.6" className="mold-rim-pulse" />
        </svg>
      </span>
    )
  // anvil
  return (
    <span className="crucible-bob relative inline-block" style={{ width: 84, height: 84 }}>
      <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
        <path d="M3 12h14c0 0-1 4-5 4h-2l-1 3H7l1-3H5c-1.6 0-2-1.2-2-2z" fill="var(--color-ink-700)" stroke="var(--color-ink-600)" strokeWidth="0.6" />
        <rect x="9" y="18" width="6" height="3" rx="0.6" fill="var(--color-ink-700)" stroke="var(--color-ink-600)" strokeWidth="0.5" />
        <rect x="3" y="12" width="14" height="1.4" rx="0.6" fill="rgba(255,122,26,0.45)" />
      </svg>
    </span>
  )
}

export function ForgeEmpty({
  icon,
  title,
  body,
  to,
  cta,
}: {
  icon: 'anvil' | 'mold' | 'crucible'
  title: string
  body: string
  to: string
  cta: string
}) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <Glyph icon={icon} />
      <h4 className="font-display mt-3 text-text-hi">{title}</h4>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-text-mid">{body}</p>
      <Link
        to={to}
        className="ember-glow-host mt-4 inline-flex items-center justify-center rounded-btn bg-gradient-to-b from-forge-400 to-forge-600 px-4 py-2 text-xs font-semibold text-ink-950 shadow-lg shadow-forge-600/25 transition hover:brightness-110"
      >
        {cta} →
      </Link>
    </div>
  )
}
