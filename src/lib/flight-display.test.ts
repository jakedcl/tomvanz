import {describe, expect, it} from 'vitest'

import {dominantFlightModePill, flightModePillLabel, maxSpeedMphFromSeries} from './flight-display'

describe('flightModePillLabel', () => {
  it('maps osd.flycState to card pills', () => {
    expect(flightModePillLabel('GPSAtti')).toBe('Normal mode')
    expect(flightModePillLabel('GPS Atti')).toBe('Normal mode')
    expect(flightModePillLabel('GPSNormal')).toBe('Normal mode')
    expect(flightModePillLabel('P-GPS')).toBe('Normal mode')

    expect(flightModePillLabel('GPSSport')).toBe('Sport mode')
    expect(flightModePillLabel('Sport')).toBe('Sport mode')

    expect(flightModePillLabel('Tripod')).toBe('Cinematic mode')
    expect(flightModePillLabel('GPSTripod')).toBe('Cinematic mode')
    expect(flightModePillLabel('Cine')).toBe('Cinematic mode')
    expect(flightModePillLabel('CineSmooth')).toBe('Cinematic mode')
    expect(flightModePillLabel('GPSCine')).toBe('Cinematic mode')
    expect(flightModePillLabel('GPSGentle')).toBe('Cinematic mode')

    expect(flightModePillLabel('Atti')).toBe('Atti mode')
    expect(flightModePillLabel('Manual')).toBe('Manual mode')
  })

  it('does not treat GPSAtti as Atti mode', () => {
    expect(flightModePillLabel('GPSAtti')).not.toBe('Atti mode')
  })

  it('ignores landing, takeoff, and go-home states', () => {
    expect(flightModePillLabel('Landing')).toBeNull()
    expect(flightModePillLabel('TakeOff')).toBeNull()
    expect(flightModePillLabel('GoHome')).toBeNull()
    expect(flightModePillLabel('Pano')).toBeNull()
  })

  it('maps GPSNovice to Beginner mode', () => {
    expect(flightModePillLabel('GPSNovice')).toBe('Beginner mode')
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
      {mode: 'GPSNormal', t: 2} as never,
    ])
    expect(label).toBe('Sport mode')
  })

  it('skips takeoff and landing when choosing dominant mode', () => {
    const label = dominantFlightModePill([
      {mode: 'TakeOff', t: 0} as never,
      {mode: 'Landing', t: 1} as never,
      {mode: 'GPSAtti', t: 2} as never,
      {mode: 'GPSAtti', t: 3} as never,
    ])
    expect(label).toBe('Normal mode')
  })
})