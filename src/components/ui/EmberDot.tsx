/** Soft breathing ember status dot — opacity + halo only, no layout movement.
    The global prefers-reduced-motion rule neutralizes the .ember-dot animation. */
export function EmberDot({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`ember-dot inline-block h-1.5 w-1.5 rounded-full bg-forge-400 ${className}`}
    />
  )
}
