import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from 'react'
import { motion, useReducedMotion } from 'motion/react'

type Variant = 'primary' | 'secondary'
type Size = 'xs' | 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-forge-400 to-forge-600 text-ink-950 shadow-lg shadow-forge-600/25 hover:brightness-110 active:brightness-95 ember-glow-host',
  secondary: 'border border-ink-600 bg-ink-800 text-text-hi hover:border-zinc-500 hover:bg-ink-700',
}

const SIZES: Record<Size, string> = {
  xs: 'px-3 py-1.5 text-xs',
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
}

const BASE = 'inline-flex items-center justify-center rounded-btn font-semibold transition'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const reduce = useReducedMotion()
  return (
    <motion.button
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...(props as ComponentProps<typeof motion.button>)}
    />
  )
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  const reduce = useReducedMotion()
  return (
    <motion.a
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...(props as ComponentProps<typeof motion.a>)}
    />
  )
}
