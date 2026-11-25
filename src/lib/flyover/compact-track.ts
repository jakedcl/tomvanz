import type {FlightSeriesSample} from '@/lib/flight-log'
import {simplifyTrack3D, type Point3} from './track3d'

/** Most points a flight is thinned to for drawing. */
export const MAX_TUBE_POINTS = 160

/**
 * A flight's stored log (a JSON string of one sample a second) boiled down to the 3D points the tubes need:
 * longitude, latitude, height above takeoff. Returns null when there is no usable log.
 */
export function compactFlightTrack(seriesJson: string | null | undefined): Point3[] | null {
  if (!seriesJson) return null
  let samples: FlightSeriesSample[]
  try {
    const parsed: unknown = JSON.parse(seriesJson)
    if (!Array.isArray(parsed)) return null
    samples = parsed as FlightSeriesSample[]
  } catch {
    return null
  }
  const points: Point3[] = []
  for (const s of samples) {
    if (!s || !Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue
    points.push([s.lng, s.lat, Number.isFinite(s.height) ? Math.max(0, s.height) : 0])
  }
  if (points.length < 2) return null
  return simplifyTrack3D(points, 3, MAX_TUBE_POINTS)
}
