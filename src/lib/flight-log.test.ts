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
  it('uses place only without a date', () => {
    expect(formatDefaultTitle('Emerson Hill')).toBe('Emerson Hill')
  })

  it('falls back when place is missing', () => {
    expect(formatDefaultTitle(undefined)).toBe('Flight')
  })
})