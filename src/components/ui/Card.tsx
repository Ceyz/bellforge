import type { HTMLAttributes } from 'react'

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-card border border-ink-600 bg-ink-800/60 p-6 transition ${className}`}
      {...props}
    />
  )
}
