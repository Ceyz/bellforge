import { StatusPill, type Status } from '../ui/StatusPill'

export function PageHeader({
  title,
  subtitle,
  status,
}: {
  title: string
  subtitle: string
  status?: Status
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl text-text-hi sm:text-4xl">{title}</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-mid">{subtitle}</p>
      </div>
      {status && <StatusPill status={status} />}
    </div>
  )
}
