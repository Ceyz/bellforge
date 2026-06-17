/** Relative "x ago" from a UNIX-seconds timestamp. `suffix` (default true)
    appends " ago"; Trade's compact offers column passes { suffix: false } to
    keep "5m"/"2h". Single source for what were three drifting local helpers. */
export function timeAgo(sec: number, { suffix = true }: { suffix?: boolean } = {}): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec)
  const s = suffix ? ' ago' : ''
  if (d < 60) return `${d}s${s}`
  if (d < 3600) return `${Math.floor(d / 60)}m${s}`
  if (d < 86400) return `${Math.floor(d / 3600)}h${s}`
  return `${Math.floor(d / 86400)}d${s}`
}
