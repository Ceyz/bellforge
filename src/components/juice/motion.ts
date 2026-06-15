/** Shared spring / ease vocabulary for the juice system. Keep these aligned with
    the existing Reveal / PageTransition / CountUp easings so motion feels coherent. */
export const EASE = [0.22, 1, 0.36, 1] as const // matches Reveal/PageTransition/CountUp

export const SPRING_SNAP = { type: 'spring', stiffness: 600, damping: 18 } as const // press / hammer slam
export const SPRING_POP = { type: 'spring', stiffness: 300, damping: 16 } as const // appear w/ overshoot
export const SPRING_SOFT = { type: 'spring', stiffness: 120, damping: 20, mass: 0.6 } as const // bar fill
export const SPRING_TOGGLE = { type: 'spring', stiffness: 400, damping: 32 } as const // matches nav underline

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
