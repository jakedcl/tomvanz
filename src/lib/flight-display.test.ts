import {describe, expect, it} from 'vitest'

import {dominantFlightModePill, flightModePillLabel, maxSpeedMphFromSeries} from './flight-display'

describe('flightModePillLabel', () => {
  it('maps DJI mode strings', () => {
    expect(flightModePillLabel('Sport')).toBe('Sport mode')
    expect(flightModePillLabel('GPS Normal')).toBe('Normal mode')
    expect(flightModePillLabel('CineSmooth')).toBe('Cinematic mode')
    expect(flightModePillLabel('Tripod')).toBe('Normal mode')
  })
})

describe('maxSpeedMphFromSeries', () => {
  it('uses telemetry speed', () => {
    expect(maxSpeedMphFromSeries([{speed: 10, t: 0} as never])).toBeCloseTo(22.37, 1)
  })
})

describe('dominantFlightModePill', () => {
  it('picks the most common mapped label', () => {
    const label = dominantFlightModePill([
      {mode: 'Sport', t: 0} as never,
      {mode: 'Sport', t: 1} as never,
      {mode: 'GPS', t: 2} as never,
    ])
    expect(label).toBe('Sport mode')
  })
})