import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-forge-400 to-forge-600 text-ink-950 shadow-lg shadow-forge-600/25 hover:brightness-110 active:brightness-95',
  secondary:
    'border border-ink-600 bg-ink-800 text-text-hi hover:border-zinc-500 hover:bg-ink-700',
}

const BASE = 'inline-flex items-center justify-center rounded-btn px-5 py-2.5 text-sm font-semibold transition'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />
}

export function LinkButton({
  variant = 'primary',
  className = '',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />
}
