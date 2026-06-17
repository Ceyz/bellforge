import { describe, it, expect } from 'vitest'
import { psbtMetrics, poolMetrics, smartRoute, fmtPrice, fmtPct } from './routing'

describe('routing (illustrative PSBT estimate; pool is R&D → null)', () => {
  it('psbtMetrics is null for a non-positive amount', () => {
    expect(psbtMetrics(0).price).toBeNull()
    expect(psbtMetrics(-5).slippagePct).toBeNull()
  })

  it('slippage grows with size; price stays above the mid', () => {
    const small = psbtMetrics(100)
    const big = psbtMetrics(40000)
    expect(small.price).toBeGreaterThan(0)
    expect(big.slippagePct!).toBeGreaterThan(small.slippagePct!)
  })

  it('pool metrics are always null — no simulated pool price', () => {
    expect(poolMetrics().price).toBeNull()
    expect(poolMetrics().slippagePct).toBeNull()
  })

  it('smartRoute is always psbt while pools are R&D', () => {
    expect(smartRoute(100)).toBe('psbt')
    expect(smartRoute(0)).toBe('psbt')
  })

  it('formatters render "—" for null and fixed precision otherwise', () => {
    expect(fmtPrice(null)).toBe('—')
    expect(fmtPrice(0.0045)).toBe('0.00450')
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(1.234)).toBe('1.2%')
  })
})
