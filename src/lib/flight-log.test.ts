import {describe, expect, it} from 'vitest'

import {formatDefaultTitle, isFlightLogFileName} from './flight-log'

describe('isFlightLogFileName', () => {
  it('matches DJI flight log naming patterns', () => {
    expect(isFlightLogFileName('FlightRecord_2026.txt')).toBe(true)
    expect(isFlightLogFileName('DJIFlightRecord_test.txt')).toBe(true)
    expect(isFlightLogFileName('flight.txt')).toBe(false)
  })
})

describe('formatDefaultTitle', () => {
  it('joins date and place with a middle dot', () => {
    expect(formatDefaultTitle('2026-05-14T14:00:00.000Z', 'Emerson Hill')).toMatch(/May 14, 2026 · Emerson Hill/)
  })
})