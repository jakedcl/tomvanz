import {describe, expect, it} from 'vitest'

import {
  distanceToSegmentMeters,
  minDistanceToPolylineMeters,
  planRoutePhotoLinks,
  ROUTE_PHOTO_NEAR_METERS,
  routePhotoLinkWindow,
} from './route-photo-link'

describe('routePhotoLinkWindow', () => {
  it('pads before and after like flight linking', () => {
    const {start, end} = routePhotoLinkWindow('2024-06-01T10:00:00.000Z', '2024-06-01T11:00:00.000Z')
    expect(new Date(start).getTime()).toBe(new Date('2024-06-01T10:00:00.000Z').getTime() - 5_000)
    expect(new Date(end).getTime()).toBe(new Date('2024-06-01T11:00:00.000Z').getTime() + 15_000)
  })
})

describe('distanceToSegmentMeters', () => {
  it('is zero on the line', () => {
    const d = distanceToSegmentMeters([-73.9, 44.1], [-73.9, 44.1], [-73.89, 44.11])
    expect(d).toBeLessThan(1)
  })
})

describe('planRoutePhotoLinks', () => {
  const line: [number, number][] = [
    [-73.91, 44.1],
    [-73.9, 44.1],
    [-73.89, 44.1],
  ]
  const start = '2024-06-01T10:00:00.000Z'
  const end = '2024-06-01T11:00:00.000Z'

  it('links photos in the time window and near the track', () => {
    const {linkIds} = planRoutePhotoLinks(
      [
        {
          _id: 'a',
          takenAt: '2024-06-01T10:30:00.000Z',
          lat: 44.10005,
          lng: -73.9,
        },
        {
          _id: 'b',
          takenAt: '2024-06-01T10:30:00.000Z',
          lat: 44.5,
          lng: -73.9,
        },
      ],
      start,
      end,
      line,
    )
    expect(linkIds).toEqual(['a'])
  })

  it('skips photos without timestamps', () => {
    const {linkIds} = planRoutePhotoLinks(
      [{_id: 'c', lat: 44.1, lng: -73.9}],
      start,
      end,
      line,
    )
    expect(linkIds).toEqual([])
  })

  it('respects distance threshold', () => {
    const far = minDistanceToPolylineMeters(44.102, -73.9, line)
    expect(far).toBeGreaterThan(ROUTE_PHOTO_NEAR_METERS)
  })
})