/** Animated forge flame mark. The inner SVG flickers (flame-flicker, RM-gated by
    the global kill) and the host blooms an ember glow on hover — sitewide "alive"
    identity from one component. */
export function ForgeMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <span
      className={`flame-flicker ember-glow-host flex items-center justify-center rounded-md bg-gradient-to-b from-forge-400 to-forge-600 shadow-[0_0_16px_-4px_rgba(255,76,0,0.6)] transition-shadow duration-300 hover:shadow-[0_0_22px_-2px_rgba(255,122,26,0.85)] ${className}`}
    >
      <svg width="60%" height="60%" viewBox="0 0 24 24" fill="currentColor" className="text-ink-950" aria-hidden="true">
        <path d="M12 2c2.6 4 1 7-1.5 9.5C8 14 6 16.5 6 20a6 6 0 0012 0c0-2.2-1-4.2-2.4-6 .7 1.6.6 3.2-.6 4.4-1.3 1.3-3.2 1-3.2-1 0-2.4 3.8-4.6 3.8-9.4 0-2.5-1.6-4.6-3.6-6z" />
      </svg>
    </span>
  )
}

/** Clean modern wordmark (Inter, not the pixel face — that stays for hero
    headlines only). "forge" in ember. */
export function Wordmark() {
  return (
    <span className="text-[17px] font-semibold tracking-tight text-text-hi">
      Bell<span className="text-forge-400">forge</span>
    </span>
  )
}
