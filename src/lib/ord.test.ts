import { describe, it, expect } from 'vitest'
import { decimalToRaw, fracLen } from './ord'

// The /address endpoint gives divisibility-applied decimals; /output gives raw.
// decimalToRaw must bridge them exactly (else balances/swaps mis-size).
describe('decimalToRaw (address decimal → raw, must match /output raw)', () => {
  it('"1.1" @ div 3 == the documented /output raw 1100', () => expect(decimalToRaw('1.1', 3)).toBe(1100n))
  it('integer rune (div 0)', () => expect(decimalToRaw('46', 0)).toBe(46n))
  it('trailing zero is harmless', () => expect(decimalToRaw('1.10', 3)).toBe(1100n))
  it('sub-1 value', () => expect(decimalToRaw('0.001', 3)).toBe(1n))
  it('truncates excess fractional digits to divisibility', () => expect(decimalToRaw('1.9999', 2)).toBe(199n))
  it('negative', () => expect(decimalToRaw('-1.1', 3)).toBe(-1100n))
  it('garbage stays 0, never throws', () => expect(decimalToRaw('', 3)).toBe(0n))
})

describe('fracLen', () => {
  it('counts fractional digits', () => expect(fracLen('1.1')).toBe(1))
  it('integer has none', () => expect(fracLen('46')).toBe(0))
})
