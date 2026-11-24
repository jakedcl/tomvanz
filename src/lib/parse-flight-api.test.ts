import {describe, expect, it, vi} from 'vitest'

import {
  enrichParseFlightPlace,
  flightStudioPatchFromParse,
  needsClientPlaceFallback,
} from './parse-flight-api'

describe('enrichParseFlightPlace', () => {
  const base = {
    defaultTitle: 'Flight',
    durationSeconds: 120,
    distanceMeters: 100,
    maxHeightMeters: 50,
    aircraft: 'DJI Mini 3',
    displayCoordinates: '[[-74.0,40.58]]',
    series: '[]',
    videoSegments: [],
    home: {lat: 40.58, lng: -74},
  }

  it('fills place and title when server returned Flight fallback', async () => {
    const geocode = vi.fn(async () => 'Todt Hill')
    const enriched = await enrichParseFlightPlace(base, geocode)
    expect(geocode).toHaveBeenCalledWith(40.58, -74)
    expect(enriched.place).toBe('Todt Hill')
    expect(enriched.defaultTitle).toBe('Todt Hill')
  })

  it('leaves parse unchanged when place already set', async () => {
    const geocode = vi.fn(async () => 'Should not run')
    const parsed = {...base, place: 'Emerson Hill', defaultTitle: 'Emerson Hill'}
    expect(needsClientPlaceFallback(parsed)).toBe(false)
    const enriched = await enrichParseFlightPlace(parsed, geocode)
    expect(geocode).not.toHaveBeenCalled()
    expect(enriched.defaultTitle).toBe('Emerson Hill')
  })
})

describe('flightStudioPatchFromParse', () => {
  it('fills map and stats fields from parse payload', () => {
    const patch = flightStudioPatchFromParse(
      {
        defaultTitle: 'Emerson Hill',
        startedAt: '2024-05-14T18:00:00.000Z',
        place: 'Emerson Hill',
        durationSeconds: 420,
        distanceMeters: 1200,
        maxHeightMeters: 80,
        aircraft: 'DJI Mini 3',
        displayCoordinates: '[[-74.0,40.6]]',
        series: '[{"t":0,"lng":-74,"lat":40.6}]',
        videoSegments: [{startSeconds: 10, endSeconds: 90}],
        home: {lat: 40.6, lng: -74},
      },
      'FlightRecord_2024-05-14.txt',
    )

    expect(patch.title).toBe('Emerson Hill')
    expect(patch.sourceFilename).toBe('FlightRecord_2024-05-14.txt')
    expect(patch.durationSeconds).toBe(420)
    expect(patch.home).toEqual({_type: 'geopoint', lat: 40.6, lng: -74})
    expect(patch.videoSegments).toEqual([{startSeconds: 10, endSeconds: 90}])
  })

  it('does not overwrite an existing title', () => {
    const patch = flightStudioPatchFromParse(
      {
        defaultTitle: 'Emerson Hill',
        durationSeconds: 30,
        distanceMeters: 0,
        maxHeightMeters: 0,
        aircraft: 'Unknown',
        displayCoordinates: '[]',
        series: '[]',
        videoSegments: [],
      },
      'log.txt',
      'Tom’s title',
    )
    expect(patch).not.toHaveProperty('title')
  })

  it('omits optional fields when absent', () => {
    const patch = flightStudioPatchFromParse(
      {
        defaultTitle: 'Untitled flight',
        durationSeconds: 30,
        distanceMeters: 0,
        maxHeightMeters: 0,
        aircraft: 'Unknown',
        displayCoordinates: '[]',
        series: '[]',
        videoSegments: [],
      },
      'log.txt',
    )

    expect(patch).not.toHaveProperty('startedAt')
    expect(patch).not.toHaveProperty('place')
    expect(patch).not.toHaveProperty('home')
  })
})