import {aircraftMatchesPhotoModel} from './dji-camera'
import {effectiveDrone} from './drone'
import {flightEndedAtIso} from './flight-times'
import {effectiveTakenAt} from './photo-taken-at'
import {
  minDistanceToPolylineMeters,
  ROUTE_PHOTO_NEAR_METERS,
  routePhotoLinkWindow,
} from './route-photo-link'

/** Seconds before / after a drone flight when a capture may still belong to that flight. */
export const DRONE_FLIGHT_TIME_PADDING_SEC = 120

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
  trackCoords?: [number, number][]
}

export type RouteLinkTarget = {
  _id: string
  startedAt?: string
  endedAt?: string
  coordinates: [number, number][]
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

export function parseDisplayCoordinates(json: string | undefined): [number, number][] {
  if (!json?.trim()) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((p) =>
        Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
          ? ([Number(p[0]), Number(p[1])] as [number, number])
          : null,
      )
      .filter((p): p is [number, number] => p != null)
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

function routeTrackWindow(route: RouteLinkTarget): {start: string; end: string} | undefined {
  if (!route.startedAt || !route.endedAt) return undefined
  return routePhotoLinkWindow(route.startedAt, route.endedAt)
}

function flightTrackWindow(flight: FlightLinkTarget): {start: string; end: string} | undefined {
  return droneFlightLinkWindow(flight)
}

function inWindow(iso: string, start: string, end: string): boolean {
  const t = new Date(iso).getTime()
  return t >= new Date(start).getTime() && t <= new Date(end).getTime()
}

function minDistanceToTrack(
  lat: number | undefined,
  lng: number | undefined,
  coords: [number, number][] | undefined,
): number {
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

/** Plan a single photo's flight and route links (upload / backfill). */
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

  if (!photo.hasRouteRef && !drone && when && photo.lat != null && photo.lng != null) {
    for (const route of routes) {
      const window = routeTrackWindow(route)
      if (!window || !inWindow(when, window.start, window.end)) continue
      const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
      if (dist <= ROUTE_PHOTO_NEAR_METERS) {
        routeId = route._id
        break
      }
    }
  }

  if (!photo.hasFlightRef && !drone && !routeId && when && photo.lat != null && photo.lng != null) {
    for (const flight of flights) {
      const window = flightTrackWindow(flight)
      if (!window || !inWindow(when, window.start, window.end)) continue
      const dist = minDistanceToTrack(photo.lat, photo.lng, flight.trackCoords)
      if (dist <= ROUTE_PHOTO_NEAR_METERS) {
        flightId = flight._id
        break
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
  const window = routeTrackWindow(route)
  if (!window) return {linkIds}

  const {start, end} = window

  for (const photo of candidates) {
    if (photo.hasRouteRef || isDronePhoto(photo)) continue
    const when = effectiveTakenAt(photo.takenAt, photo.fileName, photo.exifDateTimeOriginal)
    if (!when || photo.lat == null || photo.lng == null) continue
    if (!inWindow(when, start, end)) continue
    const dist = minDistanceToPolylineMeters(photo.lat, photo.lng, route.coordinates)
    if (dist <= maxDistanceMeters) linkIds.push(photo._id)
  }

  return {linkIds}
}

export function patchFieldsFromSinglePlan(plan: SinglePhotoLinkPlan): PhotoLinkTargetPatch {
  const fields: PhotoLinkTargetPatch = {}
  if (plan.flightId) fields.flight = {_type: 'reference', _ref: plan.flightId}
  if (plan.routeId) fields.route = {_type: 'reference', _ref: plan.routeId}
  if (plan.linkReview) fields.linkReview = plan.linkReview
  return fields
}

export function formatProposedLink(
  plan: SinglePhotoLinkPlan,
  flights: FlightLinkTarget[],
  routes: RouteLinkTarget[],
): string {
  if (plan.flightId) {
    const f = flights.find((item) => item._id === plan.flightId)
    return f?.startedAt ? `flight:${f._id}` : `flight:${plan.flightId}`
  }
  if (plan.routeId) {
    return `route:${plan.routeId}`
  }
  if (plan.linkReview) return 'review'
  return '—'
}