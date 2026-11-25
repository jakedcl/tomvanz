import {PHOTO_LINK_PADDING_AFTER_SEC, PHOTO_LINK_PADDING_BEFORE_SEC} from './flight-photo-link'
import {haversineMeters, type LngLat} from './simplify-route'

/** Max distance from the GPX line for a photo to count as taken on the route. */
export const ROUTE_PHOTO_NEAR_METERS = 200

export function routePhotoLinkWindow(startedAtIso: string, endedAtIso: string): {start: string; end: string} {
  const startMs = new Date(startedAtIso).getTime()
  const endMs = new Date(endedAtIso).getTime()
  return {
    start: new Date(startMs - PHOTO_LINK_PADDING_BEFORE_SEC * 1000).toISOString(),
    end: new Date(endMs + PHOTO_LINK_PADDING_AFTER_SEC * 1000).toISOString(),
  }
}

/** Shortest distance from a point to a line segment (lng/lat), in meters. */
export function distanceToSegmentMeters(point: LngLat, a: LngLat, b: LngLat): number {
  const ax = a[0]
  const ay = a[1]
  const bx = b[0]
  const by = b[1]
  const px = point[0]
  const py = point[1]
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return haversineMeters(point, a)
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t))
  const q: LngLat = [ax + t * dx, ay + t * dy]
  return haversineMeters(point, q)
}

export function minDistanceToPolylineMeters(lat: number, lng: number, coords: LngLat[]): number {
  const point: LngLat = [lng, lat]
  if (coords.length === 0) return Number.POSITIVE_INFINITY
  if (coords.length === 1) return haversineMeters(point, coords[0]!)
  let min = Number.POSITIVE_INFINITY
  for (let i = 1; i < coords.length; i += 1) {
    min = Math.min(min, distanceToSegmentMeters(point, coords[i - 1]!, coords[i]!))
  }
  return min
}

export {planRoutePhotoLinks} from './photo-auto-link'