import { describe, it, expect } from 'vitest'
import { relativeTime } from '../../src/lib/relativeTime.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.parse('2026-09-19T12:00:00.000Z')
const ago = (ms) => relativeTime(NOW - ms, NOW)

describe('relativeTime', () => {
  it('says "just now" under a minute', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_000)).toBe('just now')
  })

  it('counts minutes, then hours, then days', () => {
    expect(ago(MINUTE)).toBe('1 minute ago')
    expect(ago(45 * MINUTE)).toBe('45 minutes ago')
    expect(ago(HOUR)).toBe('1 hour ago')
    expect(ago(5 * HOUR)).toBe('5 hours ago')
    expect(ago(DAY)).toBe('1 day ago')
    expect(ago(3 * DAY)).toBe('3 days ago')
  })

  it('switches to weeks at seven days', () => {
    expect(ago(6 * DAY)).toBe('6 days ago')
    expect(ago(7 * DAY)).toBe('1 week ago')
    expect(ago(20 * DAY)).toBe('2 weeks ago')
  })

  it('gives an exact date past a month, rather than "5 weeks ago"', () => {
    expect(relativeTime('2026-06-01T08:00:00.000Z', NOW)).toBe('01 Jun 2026')
  })

  it('collapses a future timestamp into the present', () => {
    // Clock skew is real — a phone with the wrong date, or a server a few
    // seconds ahead. "in 4 minutes" against a photograph of a flood is
    // nonsense, so the future reads as now.
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toBe('just now')
    expect(relativeTime(NOW + 40 * DAY, NOW)).toBe('just now')
  })

  it('returns null when there is no usable time, so a card can omit the line', () => {
    for (const value of [null, undefined, '', 'not a date', {}, NaN]) {
      expect(relativeTime(value, NOW)).toBeNull()
    }
  })

  it('accepts a millisecond timestamp as well as an ISO string', () => {
    expect(relativeTime(NOW - 2 * HOUR, NOW)).toBe('2 hours ago')
    expect(relativeTime(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe('2 hours ago')
  })
})
