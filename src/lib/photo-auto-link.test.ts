import {describe, expect, it} from 'vitest'

import {aircraftMatchesPhotoModel} from './dji-camera'
import {
  DRONE_FLIGHT_TIME_PADDING_SEC,
  planPhotoLinks,
  planRoutePhotoLinks,
  planSinglePhotoLinks,
  type FlightLinkTarget,
} from './photo-auto-link'

describe('planPhotoLinks (drone + aircraft)', () => {
  const flight: FlightLinkTarget = {
    _id: 'flight-1',
    startedAt: '2026-05-14T18:00:00.000Z',
    durationSeconds: 600,
    aircraft: 'DJI Mini 3',
    trackCoords: [
      [-73.91, 44.1],
      [-73.9, 44.1],
    ],
  }

  it('links a matching drone photo in the padded window', () => {
    const plan = planPhotoLinks(
      [
        {
          _id: 'a',
          takenAt: '2026-05-14T18:05:00.000Z',
          fileName: 'DJI_0001.JPG',
          cameraModel: 'FC3682',
        },
      ],
      flight,
    )
    expect(plan.linkIds).toEqual(['a'])
  })

  it('does not link when aircraft model mismatches', () => {
    const plan = planPhotoLinks(
      [
        {
          _id: 'b',
          takenAt: '2026-05-14T18:05:00.000Z',
          fileName: 'DJI_0002.JPG',
          cameraModel: 'FC2103',
        },
      ],
      flight,
    )
    expect(plan.linkIds).toEqual([])
    expect(plan.unlinkedLabels).toContain('DJI_0002.JPG')
  })

  it('ignores ground photos', () => {
    const plan = planPhotoLinks(
      [{_id: 'c', takenAt: '2026-05-14T18:05:00.000Z', fileName: 'IMG_100.jpg'}],
      flight,
    )
    expect(plan.linkIds).toEqual([])
  })

  it(`uses a ${DRONE_FLIGHT_TIME_PADDING_SEC}s pad on each side`, () => {
    expect(
      planPhotoLinks(
        [{_id: 'd', takenAt: '2026-05-14T17:58:30.000Z', fileName: 'DJI_x.JPG', cameraModel: 'FC3682'}],
        flight,
      ).linkIds,
    ).toEqual(['d'])
  })
})

describe('planRoutePhotoLinks', () => {
  const line: [number, number][] = [
    [-73.91, 44.1],
    [-73.9, 44.1],
  ]

  it('skips drone photos', () => {
    const {linkIds} = planRoutePhotoLinks(
      [{_id: 'd', takenAt: '2024-06-01T10:30:00.000Z', fileName: 'DJI_1.JPG', lat: 44.1, lng: -73.9}],
      {_id: 'r', startedAt: '2024-06-01T10:00:00.000Z', endedAt: '2024-06-01T11:00:00.000Z', coordinates: line},
    )
    expect(linkIds).toEqual([])
  })

  it('links ground photos on the line in the time window', () => {
    const {linkIds} = planRoutePhotoLinks(
      [
        {
          _id: 'g',
          takenAt: '2024-06-01T10:30:00.000Z',
          fileName: 'phone.jpg',
          lat: 44.10005,
          lng: -73.9,
        },
      ],
      {_id: 'r', startedAt: '2024-06-01T10:00:00.000Z', endedAt: '2024-06-01T11:00:00.000Z', coordinates: line},
    )
    expect(linkIds).toEqual(['g'])
  })
})

describe('planSinglePhotoLinks ambiguity', () => {
  it('sets linkReview when two flights tie on GPS distance', () => {
    const flights: FlightLinkTarget[] = [
      {
        _id: 'f1',
        startedAt: '2026-05-14T18:00:00.000Z',
        durationSeconds: 600,
        aircraft: 'DJI Mini 3',
        trackCoords: [[-73.9, 44.10001]],
      },
      {
        _id: 'f2',
        startedAt: '2026-05-14T18:00:00.000Z',
        durationSeconds: 600,
        aircraft: 'DJI Mini 3',
        trackCoords: [[-73.9, 44.09999]],
      },
    ]
    const plan = planSinglePhotoLinks(
      {
        _id: 'p',
        takenAt: '2026-05-14T18:05:00.000Z',
        fileName: 'DJI_003.JPG',
        cameraModel: 'FC3682',
        lat: 44.1,
        lng: -73.9,
      },
      flights,
      [],
    )
    expect(plan.flightId).toBeUndefined()
    expect(plan.linkReview).toMatch(/Multiple flights/)
  })
})

describe('aircraftMatchesPhotoModel', () => {
  it('maps FC3682 to DJI Mini 3', () => {
    expect(aircraftMatchesPhotoModel('DJI Mini 3', 'FC3682')).toBe(true)
  })
})
