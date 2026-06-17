import { describe, it, expect } from 'vitest'
import { timeAgo } from './format'

const nowSec = () => Math.floor(Date.now() / 1000)

describe('timeAgo', () => {
  it('seconds bucket with " ago" suffix', () => expect(timeAgo(nowSec() - 5)).toMatch(/^\ds ago$/))
  it('minutes', () => expect(timeAgo(nowSec() - 90)).toBe('1m ago'))
  it('hours', () => expect(timeAgo(nowSec() - 7300)).toBe('2h ago'))
  it('days', () => expect(timeAgo(nowSec() - 260000)).toBe('3d ago'))
  it('compact form drops the suffix', () => expect(timeAgo(nowSec() - 90, { suffix: false })).toBe('1m'))
  it('clamps a future timestamp to 0s', () => expect(timeAgo(nowSec() + 100)).toBe('0s ago'))
})
