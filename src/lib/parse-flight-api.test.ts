import {describe, expect, it} from 'vitest'

import {flightStudioPatchFromParse} from './parse-flight-api'

describe('flightStudioPatchFromParse', () => {
  it('fills map and stats fields from parse payload', () => {
    const patch = flightStudioPatchFromParse(
      {
        defaultTitle: 'May 14 · Emerson Hill',
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

    expect(patch.title).toBe('May 14 · Emerson Hill')
    expect(patch.sourceFilename).toBe('FlightRecord_2024-05-14.txt')
    expect(patch.durationSeconds).toBe(420)
    expect(patch.home).toEqual({_type: 'geopoint', lat: 40.6, lng: -74})
    expect(patch.videoSegments).toEqual([{startSeconds: 10, endSeconds: 90}])
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