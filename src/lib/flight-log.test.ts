import {describe, expect, it} from 'vitest'

import {durationFromTimeSeries, formatDefaultTitle, isFlightLogFileName} from './flight-log'

describe('isFlightLogFileName', () => {
  it('matches DJI flight log naming patterns', () => {
    expect(isFlightLogFileName('FlightRecord_2026.txt')).toBe(true)
    expect(isFlightLogFileName('DJIFlightRecord_test.txt')).toBe(true)
    expect(isFlightLogFileName('flight.txt')).toBe(false)
  })
})

describe('durationFromTimeSeries', () => {
  it('uses max minus min when flyTime does not start at zero', () => {
    const samples = [
      {t: 38.1},
      {t: 200},
      {t: 1443},
    ]
    expect(durationFromTimeSeries(samples)).toBeCloseTo(1404.9, 1)
  })
})

describe('formatDefaultTitle', () => {
  it('joins date and place with a middle dot', () => {
    expect(formatDefaultTitle('2026-05-14T14:00:00.000Z', 'Emerson Hill')).toMatch(/May 14, 2026 · Emerson Hill/)
  })

  it('formats the calendar date in America/New_York', () => {
    // 2026-05-15 02:00 UTC is still May 14 in New York.
    expect(formatDefaultTitle('2026-05-15T02:00:00.000Z', undefined)).toBe('May 14, 2026')
  })
})