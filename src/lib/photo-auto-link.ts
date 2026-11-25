import {aircraftMatchesPhotoModel} from './dji-camera'
import {effectiveDrone} from './drone'
import {flightEndedAtIso} from './flight-times'
import {effectiveTakenAt} from './photo-taken-at'
import {
  minDistanceToPolylineMeters,
  ROUTE_PHOTO_NEAR_METERS,
  routePhotoLinkWindow,
} from './route-photo-link'
import {haversineMeters, type LngLat} from './simplify-route'

/** Seconds before / after a drone flight when a capture may still belong to that flight. */
export const DRONE_FLIGHT_TIME_PADDING_SEC = 120

/** Ground photos with no time window match may link to the nearest path within this distance. */
export const GROUND_PROXIMITY_METERS = 400

export type PhotoLinkCandidate = {
  _id: string
  takenAt?: string
  fileName?: string
  exifDateTimeOriginal?: string
  lat?: number
  lng?: number
  drone?: boolean
  cameraMake?: string
  cameraModel?: string
  hasFlightRef?: boolean
  hasRouteRef?: boolean
}

export type FlightLinkTarget = {
  _id: string
  startedAt: string
  endedAt?: string
  durationSeconds: number
  aircraft?: string
  trackCoords?: LngLat[]
}

export type RouteLinkTarget = {
  _id: string
  startedAt?: string
  endedAt?: string
  coordinates: LngLat[]
}

export type PhotoLinkPlan = {
  linkIds: string[]
  unlinkedLabels: string[]
}

export type SinglePhotoLinkPlan = {
  flightId?: string
  routeId?: string
  linkReview?: string
}

export type PhotoLinkTargetPatch = {
  flight?: {_type: 'reference'; _ref: string}
  route?: {_type: 'reference'; _ref: string}
  linkReview?: string | null
}

function labelFor(candidate: PhotoLinkCandidate): string {
  return candidate.fileName?.trim() || candidate._id
}

function isDronePhoto(candidate: PhotoLinkCandidate): boolean {
  return effectiveDrone(candidate.drone, candidate.fileName)
}

export function parseDisplayCoordinates(json: string | undefined): LngLat[] {
  if (!json?.trim()) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((p) =>
        Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          ? ([Number(p[0]), Number(p[1])] as LngLat)
          : null,
      )
      .filter((p): p is LngLat => p != null)
  } catch {
    return []
  }
}

export function flightEndedAt(
  startedAt: string,
  durationSeconds: number,
  endedAt?: string,
): string | undefined {
  return endedAt ?? flightEndedAtIso(startedAt, durationSeconds)
}

export function droneFlightLinkWindow(flight: FlightLinkTarget): {start: string; end: string} | undefined {
  if (!flight.startedAt) return undefined
  const endIso = flightEndedAt(flight.startedAt, flight.durationSeconds, flight.endedAt)
  if (!endIso) return undefined
  const startMs = new Date(flight.startedAt).getTime() - DRONE_FLIGHT_TIME_PADDING_SEC * 1000
  const endMs = new Date(endIso).getTime() + DRONE_FLIGHT_TIME_PADDING_SEC * 1000
  return {start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString()}
}

function inWindow(iso: string, start: string, end: string): boolean {
  const t = new Date(iso).getTime()
  return t >= new Date(start).getTime() && t <= new Date(end).getTime()
}

function minDistanceToTrack(lat: number | undefined, lng: number | undefined, coords: LngLat[] | undefined): number {
  if (lat == null || lng == null || !coords?.length) return Number.POSITIVE_INFINITY
  return minDistanceToPolylineMeters(lat, lng, coords)
}

function photoMatchesFlight(
  candidate: PhotoLinkCandidate,
  flight: FlightLinkTarget,
  when: string,
): boolean {
  if (!isDronePhoto(candidate)) return false
  const window = droneFlightLinkWindow(flight)
  if (!window || !inWindow(when, window.start, window.end)) return false
  if (flight.aircraft?.trim()) {
    return aircraftMatchesPhotoModel(flight.aircraft, candidate.cameraModel, candidate.cameraMake)
  }
  return true
}

/** Pick the best flight among ties using nearest GPS point on the track. */
function pickFlightByGps(
  candidate: PhotoLinkCandidate,
  flights: FlightLinkTarget[],
): {flight?: FlightLinkTarget; ambiguous: boolean} {
  if (flights.length === 0) return {ambiguous: false}
  if (flights.length === 1) return {flight: flights[0], ambiguous: false}

  const withDistance = flights.map((flight) => ({
    flight,
    dist: minDistanceToTrack(candidate.lat, candidate.lng, flight.trackCoords),
  }))
  withDistance.sort((a, b) => a.dist - b.dist)
  const best = withDistance[0]!
  const second = withDistance[1]!
  if (
    Number.isFinite(best.dist) &&
    Number.isFinite(second.dist) &&
    Math.abs(best.dist - second.dist) < 5
  ) {
    return {ambiguous: true}
  }
  return {flight: best.flight, ambiguous: false}
}

/**
 * Decide which photos to attach to one flight (batch, from flight upload).
 * Only drone photos with matching aircraft and a time in the padded flight window.
 */
export function planPhotoLinks(candidates: PhotoLinkCandidate[], flight: FlightLinkTarget): PhotoLinkPlan {
  const linkIds: string[] = []
  const unlinkedLabels: string[] = []

  const window = droneFlightLinkWindow(flight)

  for (const photo of candidates) {
    if (photo.hasFlightRef) continue
    const when = effectiveTakenAt(photo.takenAt, photo.fileName, photo.exifDateTimeOriginal)
    if (!when) {
      if (isDronePhoto(photo)) unlinkedLabels.push(labelFor(photo))
      continue
    }
    if (photoMatchesFlight(photo, flight, when)) {
      linkIds.push(photo._id)
      continue
    }
    if (isDronePhoto(photo) && window && inWindow(when, window.start, window.end)) {
      unlinkedLabels.push(labelFor(photo))
    }
  }

  return {linkIds, unlinkedLabels}
}

/** Plan a single photo's flight and route links (bulk upload / backfill). */
export function planSinglePhotoLinks(
  photo: PhotoLinkCandidate,
  flights: FlightLinkTarget[],
  routes: RouteLinkTarget[],
): SinglePhotoLinkPlan {
  const when = effectiveTakenAt(photo.takenAt, photo.fileName, photo.exifDateTimeOriginal)
  const drone = isDronePhoto(photo)

  let flightId: string | undefined
  let routeId: string | undefined
  let linkReview: string | undefined

  if (!photo.hasFlightRef && drone && when) {
    const matching = flights.filter((f) => photoMatchesFlight(photo, f, when))
    const {flight, ambiguous} = pickFlightByGps(photo, matching)
    if (ambiguous) {
      linkReview = 'Multiple flights matched this drone photo; pick a flight manually.'
    } else if (flight) {
      flightId = flight._id
    }
  }

  if (!photo.hasRouteRef && !drone) {
    if (when) {
      for (const route of routes) {
        if (!route.startedAt || !route.endedAt) continue
        const {start, end} = routePhotoLinkWindow(route.startedAt, route.endedAt)
        if (!inWindow(when, start, end)) continue
        if (photo.lat == null || photo.lng == null) continue
        const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
        if (dist <= ROUTE_PHOTO_NEAR_METERS) {
          routeId = route._id
          break
        }
      }
    }
    if (!routeId && photo.lat != null && photo.lng != null) {
      let best: {id: string; dist: number} | undefined
      let tie = false
      for (const route of routes) {
        const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
        if (dist > GROUND_PROXIMITY_METERS) continue
        if (!best || dist < best.dist) {
          best = {id: route._id, dist}
          tie = false
        } else if (best && Math.abs(dist - best.dist) < 5) {
          tie = true
        }
      }
      if (tie) {
        linkReview = linkReview ?? 'Multiple routes are equally near; pick a route manually.'
      } else if (best) {
        routeId = best.id
      }
    }

    if (!routeId && !flightId && photo.lat != null && photo.lng != null && when) {
      let bestFlight: {id: string; dist: number} | undefined
      let tie = false
      for (const flight of flights) {
        const dist = minDistanceToTrack(photo.lat, photo.lng, flight.trackCoords)
        if (dist > GROUND_PROXIMITY_METERS) continue
        if (!bestFlight || dist < bestFlight.dist) {
          bestFlight = {id: flight._id, dist}
          tie = false
        } else if (bestFlight && Math.abs(dist - bestFlight.dist) < 5) {
          tie = true
        }
      }
      if (tie) {
        linkReview = linkReview ?? 'Multiple flights are equally near; pick manually.'
      } else if (bestFlight) {
        flightId = bestFlight.id
      }
    }
  }

  return {flightId, routeId, linkReview}
}

export function planRoutePhotoLinks(
  candidates: PhotoLinkCandidate[],
  route: RouteLinkTarget,
  maxDistanceMeters = ROUTE_PHOTO_NEAR_METERS,
): {linkIds: string[]} {
  const linkIds: string[] = []
  if (!route.startedAt || !route.endedAt) {
    // Time-less route: proximity only for ground photos
    for (const photo of candidates) {
      if (photo.hasRouteRef || isDronePhoto(photo)) continue
      if (photo.lat == null || photo.lng == null) continue
      const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
      if (dist <= GROUND_PROXIMITY_METERS) linkIds.push(photo._id)
    }
    return {linkIds}
  }

  const {start, end} = routePhotoLinkWindow(route.startedAt, route.endedAt)
  const linked = new Set<string>()

  for (const photo of candidates) {
    if (photo.hasRouteRef || isDronePhoto(photo)) continue
    const when = effectiveTakenAt(photo.takenAt, photo.fileName, photo.exifDateTimeOriginal)
    if (when && photo.lat != null && photo.lng != null && inWindow(when, start, end)) {
      const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
      if (dist <= maxDistanceMeters) {
        linked.add(photo._id)
      }
    }
  }

  for (const photo of candidates) {
    if (photo.hasRouteRef || isDronePhoto(photo) || linked.has(photo._id)) continue
    if (photo.lat == null || photo.lng == null) continue
    const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
    if (dist <= GROUND_PROXIMITY_METERS) linked.add(photo._id)
  }

  linkIds.push(...linked)

  return {linkIds}
}

export function patchFieldsFromSinglePlan(plan: SinglePhotoLinkPlan): PhotoLinkTargetPatch {
  const fields: PhotoLinkTargetPatch = {}
  if (plan.flightId) fields.flight = {_type: 'reference', _ref: plan.flightId}
  if (plan.routeId) fields.route = {_type: 'reference', _ref: plan.routeId}
  if (plan.linkReview) fields.linkReview = plan.linkReview
  return fields
}

export function nearestTrackMeters(lat: number, lng: number, coords: LngLat[]): number {
  if (coords.length === 0) return Number.POSITIVE_INFINITY
  if (coords.length === 1) return haversineMeters([lng, lat], coords[0]!)
  let min = Number.POSITIVE_INFINITY
  for (const c of coords) {
    min = Math.min(min, haversineMeters([lng, lat], c))
  }
  return min
}
