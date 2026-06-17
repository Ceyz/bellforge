import { describe, it, expect } from 'vitest'
import { allocate, formatRuneAmount, cleanSymbol, type DecodedStone } from './runes'

// allocate is the read-only subset of the Runes allocation spec that drives BOTH
// the displayed balances AND the swap edict sizing — the highest-stakes pure fn.
const N = (...bytes: number[]) => new Uint8Array(bytes)
const normal = { script: N(0x00, 0x14) } // any non-OP_RETURN script
const opret = { script: N(0x6a) } // OP_RETURN
const stone = (o: Partial<DecodedStone>): DecodedStone => ({ mint: null, pointer: null, etching: null, edicts: [], ...o })

describe('allocate (Runes spec subset)', () => {
  it('mint flows to the pointer (default = first eligible output)', () => {
    const a = allocate([normal, normal], stone({ mint: '1:0' }), 10n)
    expect(a.get(0)?.get('1:0')).toBe(10n)
    expect(a.get(1)).toBeUndefined()
  })

  it('honours an explicit pointer', () => {
    const a = allocate([normal, normal], stone({ mint: '1:0', pointer: 1 }), 10n)
    expect(a.get(1)?.get('1:0')).toBe(10n)
    expect(a.get(0)).toBeUndefined()
  })

  it('edict moves a fixed amount to a specific output, remainder to the pointer', () => {
    const a = allocate([normal, normal, opret], stone({ mint: '1:0', pointer: 0, edicts: [{ id: '1:0', amount: 3n, output: 1 }] }), 10n)
    expect(a.get(1)?.get('1:0')).toBe(3n)
    expect(a.get(0)?.get('1:0')).toBe(7n)
  })

  it('never allocates to an OP_RETURN output (edict to OP_RETURN is skipped)', () => {
    const a = allocate([normal, opret], stone({ mint: '1:0', edicts: [{ id: '1:0', amount: 5n, output: 1 }] }), 10n)
    expect(a.get(1)).toBeUndefined()
    expect(a.get(0)?.get('1:0')).toBe(10n) // all 10 fall through to the pointer (out0)
  })

  it('edict amount 0 to output==numOuts splits equally across eligible outputs', () => {
    const a = allocate([normal, normal], stone({ mint: '1:0', edicts: [{ id: '1:0', amount: 0n, output: 2 }] }), 10n)
    expect(a.get(0)?.get('1:0')).toBe(5n)
    expect(a.get(1)?.get('1:0')).toBe(5n)
  })

  it('split with remainder gives the extra to the earliest eligible outputs', () => {
    const a = allocate([normal, normal, normal], stone({ mint: '1:0', edicts: [{ id: '1:0', amount: 0n, output: 3 }] }), 10n)
    expect(a.get(0)?.get('1:0')).toBe(4n) // base 3 + remainder 1
    expect(a.get(1)?.get('1:0')).toBe(3n)
    expect(a.get(2)?.get('1:0')).toBe(3n)
  })

  it('an edict with no runes available is a no-op (no mint-from-nothing)', () => {
    const a = allocate([normal, normal], stone({ edicts: [{ id: '1:0', amount: 5n, output: 1 }] }), 0n)
    expect(a.size).toBe(0)
  })
})

describe('formatRuneAmount', () => {
  it('integer (divisibility 0)', () => expect(formatRuneAmount(46n, 0, '')).toBe('46'))
  it('applies divisibility + strips trailing zeros', () => expect(formatRuneAmount(1100n, 3, '')).toBe('1.1'))
  it('appends a symbol', () => expect(formatRuneAmount(1100n, 3, '¤')).toBe('1.1 ¤'))
  it('negative', () => expect(formatRuneAmount(-1100n, 3, '')).toBe('-1.1'))
  it('sub-1 fraction', () => expect(formatRuneAmount(1n, 3, '')).toBe('0.001'))
})

describe('cleanSymbol', () => {
  it('passes a normal symbol', () => expect(cleanSymbol('¤')).toBe('¤'))
  it('drops a lone surrogate', () => expect(cleanSymbol(String.fromCharCode(0xd800))).toBeUndefined())
  it('drops empty', () => expect(cleanSymbol('')).toBeUndefined())
})
