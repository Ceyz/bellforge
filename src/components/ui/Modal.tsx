import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Accessible modal dialog shell: backdrop + a role="dialog" panel with
    aria-modal/aria-labelledby, focus-into-on-open, a Tab focus-trap,
    focus-return-to-opener on close, and Escape — all gated by `canClose` so a
    mid-signing flow can't be dismissed. Callers pass their own heading (with the
    `labelledBy` id) + body as children. */
export function Modal({
  children,
  labelledBy,
  onClose,
  canClose = true,
  className = 'p-6',
}: {
  children: ReactNode
  labelledBy?: string
  onClose: () => void
  canClose?: boolean
  /** Panel padding/extra classes (default p-6; TokenPicker uses p-5). */
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Move focus into the dialog on open — unless something inside is already
  // focused (e.g. an autoFocus input) — and return it to the opener on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const target = panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel
      target.focus()
    }
    return () => prev?.focus?.()
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (canClose) onClose()
      return
    }
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => canClose && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-card border border-ink-600 bg-ink-850 outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
