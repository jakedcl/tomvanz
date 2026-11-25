import type {FlightSeriesSample} from '@/lib/flight-log'

/** A point on a replayable path. `height` is meters above takeoff for a flight, 0 for a route. */
export type ReplayPoint = {
  /** Seconds from the start of the replay. */
  t: number
  lng: number
  lat: number
  height: number
  /** Meters travelled so far. */
  dist: number
  /** The aircraft's own heading, when the log has one. */
  heading?: number
}

export type ReplayTrack = {
  kind: 'flight' | 'route'
  points: ReplayPoint[]
  durationSeconds: number
  lengthMeters: number
  start: {lng: number; lat: number}
  /** The time in the source (a log's own clock) that this replay's zero corresponds to. */
  sourceT0: number
}

export type ReplaySample = {
  lng: number
  lat: number
  height: number
  /** Direction of travel, degrees clockwise from north. */
  course: number
  /** 0 to 1 through the replay (by time). */
  fraction: number
  /** 0 to 1 along the path (by distance travelled), for drawing the part already covered. */
  distanceFraction: number
  t: number
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function distanceMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b, degrees clockwise from north, 0 to 360. */
export function bearingDegrees(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const phi1 = toRad(aLat)
  const phi2 = toRad(bLat)
  const dLng = toRad(bLng - aLng)
  const y = Math.sin(dLng) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng)
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360
}

/** The replay of a flight, straight from its log (1 sample a second, real time). */
export function flightReplayTrack(series: FlightSeriesSample[] | null | undefined): ReplayTrack | null {
  if (!series || series.length < 2) return null
  const sorted = [...series]
    .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.lng) && Number.isFinite(s.lat))
    .sort((a, b) => a.t - b.t)
  const points: ReplayPoint[] = []
  let dist = 0
  const t0 = sorted[0]?.t ?? 0
  for (const s of sorted) {
    const prev = points[points.length - 1]
    const t = s.t - t0
    if (prev && t <= prev.t) continue
    if (prev) dist += distanceMeters(prev.lng, prev.lat, s.lng, s.lat)
    points.push({t, lng: s.lng, lat: s.lat, height: Number.isFinite(s.height) ? Math.max(0, s.height) : 0, dist, heading: s.heading})
  }
  const last = points[points.length - 1]
  if (points.length < 2 || !last || last.t <= 0) return null
  return {kind: 'flight', points, durationSeconds: last.t, lengthMeters: dist, start: {lng: points[0]!.lng, lat: points[0]!.lat}, sourceT0: t0}
}

/** How fast a route is replayed at 1x, by what it is: there are no timestamps, so it moves at a steady pace. */
export const ROUTE_SPEED_MPS: Record<string, number> = {bike: 7, hike: 1.5, other: 3.5}

/** The replay of a route: constant speed along its length. */
export function routeReplayTrack(coords: [number, number][], activity = 'other'): ReplayTrack | null {
  if (coords.length < 2) return null
  const speed = ROUTE_SPEED_MPS[activity] ?? ROUTE_SPEED_MPS.other!
  const points: ReplayPoint[] = []
  let dist = 0
  for (const [lng, lat] of coords) {
    const prev = points[points.length - 1]
    if (prev) {
      const step = distanceMeters(prev.lng, prev.lat, lng, lat)
      if (step === 0) continue
      dist += step
    }
    points.push({t: dist / speed, lng, lat, height: 0, dist})
  }
  const last = points[points.length - 1]
  if (points.length < 2 || !last || last.t <= 0) return null
  return {kind: 'route', points, durationSeconds: last.t, lengthMeters: dist, start: {lng: points[0]!.lng, lat: points[0]!.lat}, sourceT0: 0}
}

/** Index of the last point at or before `t` (binary search). */
function indexAt(points: ReplayPoint[], t: number): number {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid]!.t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

function positionAt(track: ReplayTrack, t: number) {
  const {points} = track
  const clamped = Math.min(track.durationSeconds, Math.max(0, t))
  const i = indexAt(points, clamped)
  const a = points[i]!
  const b = points[i + 1]
  if (!b) return {lng: a.lng, lat: a.lat, height: a.height, dist: a.dist}
  const k = (clamped - a.t) / (b.t - a.t)
  return {
    lng: a.lng + (b.lng - a.lng) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    height: a.height + (b.height - a.height) * k,
    dist: a.dist + (b.dist - a.dist) * k,
  }
}

/**
 * Direction of travel at `t`, from where it was a little earlier to where it will be a little later, so a
 * jittery log doesn't make the camera twitch. If it hovers, look further out; if it never moves, use the heading.
 */
export function courseAt(track: ReplayTrack, t: number, windowSeconds = 4): number {
  for (const window of [windowSeconds, windowSeconds * 4, windowSeconds * 16]) {
    const a = positionAt(track, t - window / 2)
    const b = positionAt(track, t + window / 2)
    if (distanceMeters(a.lng, a.lat, b.lng, b.lat) > 1) return bearingDegrees(a.lng, a.lat, b.lng, b.lat)
  }
  const here = track.points[indexAt(track.points, t)]
  return here?.heading ?? 0
}

export function sampleReplay(track: ReplayTrack, t: number): ReplaySample {
  const clamped = Math.min(track.durationSeconds, Math.max(0, t))
  const {dist, ...position} = positionAt(track, clamped)
  return {
    ...position,
    course: courseAt(track, clamped),
    fraction: track.durationSeconds > 0 ? clamped / track.durationSeconds : 0,
    distanceFraction: track.lengthMeters > 0 ? Math.min(1, dist / track.lengthMeters) : 0,
    t: clamped,
  }
}

/** The time at which the replay has travelled `meters` along the path. */
export function timeAtDistance(track: ReplayTrack, meters: number): number {
  const {points} = track
  const target = Math.min(track.lengthMeters, Math.max(0, meters))
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid]!.dist <= target) lo = mid
    else hi = mid - 1
  }
  const a = points[lo]!
  const b = points[lo + 1]
  if (!b || b.dist === a.dist) return a.t
  return a.t + ((target - a.dist) / (b.dist - a.dist)) * (b.t - a.t)
}

export type ReplaySpeed = 1 | 4 | 16 | 32 | 64
/** The speeds a flight can be replayed at. */
export const REPLAY_SPEEDS: ReplaySpeed[] = [1, 4, 16]
/** Routes have no real clock to be faithful to, and can be long, so they also go 32x and 64x. */
const ROUTE_REPLAY_SPEEDS: ReplaySpeed[] = [1, 4, 16, 32, 64]

/** The speed choices to offer for a flight or a route. */
export function replaySpeedsFor(kind: 'flight' | 'route' | null): ReplaySpeed[] {
  return kind === 'route' ? ROUTE_REPLAY_SPEEDS : REPLAY_SPEEDS
}

/** How long a replay should take to watch at its starting speed. */
const TARGET_WATCH_SECONDS = 90

/** The slowest speed that gets through the whole path in about a minute and a half (16x at most). */
export function defaultReplaySpeed(durationSeconds: number): ReplaySpeed {
  for (const speed of REPLAY_SPEEDS) {
    if (durationSeconds / speed <= TARGET_WATCH_SECONDS) return speed
  }
  return 16
}
