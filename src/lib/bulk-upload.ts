import exifr from 'exifr'

import {isFlightLogFileName, type ParsedFlightLog} from './flight-log'
import {prepareRouteDisplayFields, type LngLat} from './simplify-route'

/** What the bulk uploader pulls out of a photo file. */
export type PhotoMeta = {
  lat?: number
  lng?: number
  /** When it was taken, as an ISO date-time. */
  takenAt?: string
}

/**
 * Reads the GPS position and the time taken from a photo's own data. Missing or unreadable
 * data is fine (screenshots, edited exports): the fields are simply left out.
 */
export async function readPhotoMeta(input: Blob | ArrayBuffer | Uint8Array): Promise<PhotoMeta> {
  let data: Record<string, unknown> | undefined
  try {
    data = (await exifr.parse(input, {gps: true})) ?? undefined
  } catch {
    return {}
  }
  if (!data) return {}

  const meta: PhotoMeta = {}
  const lat = Number(data.latitude)
  const lng = Number(data.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
    meta.lat = lat
    meta.lng = lng
  }

  const when = (data.DateTimeOriginal ?? data.CreateDate) as Date | string | undefined
  const takenAt = plausibleTime(when instanceof Date ? when : when ? new Date(when) : null)
  if (takenAt) meta.takenAt = takenAt
  return meta
}

/** An ISO date-time, or nothing for obviously bogus clocks (devices that were never set report 1970 or 2000). */
export function plausibleTime(date: Date | null | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined
  if (date.getFullYear() < 2005 || date.getTime() > Date.now() + 86_400_000) return undefined
  return date.toISOString()
}

const PHOTO_EXTENSIONS = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i

/** Photos only: by MIME type, or by extension when the browser doesn't report one. */
export function isPhotoFile(file: {name: string; type: string}): boolean {
  return file.type.startsWith('image/') || PHOTO_EXTENSIONS.test(file.name)
}

/** The Photo document created for an uploaded picture. The title is optional and left out when blank. */
export function photoFromUpload(assetId: string, meta: PhotoMeta, title?: string) {
  const cleanTitle = title?.trim()
  return {
    _type: 'photo' as const,
    ...(cleanTitle ? {title: cleanTitle} : {}),
    image: {_type: 'image' as const, asset: {_type: 'reference' as const, _ref: assetId}},
    ...(meta.lat != null && meta.lng != null
      ? {location: {_type: 'geopoint' as const, lat: meta.lat, lng: meta.lng}}
      : {}),
    ...(meta.takenAt ? {takenAt: meta.takenAt} : {}),
  }
}

/** Runs `worker` over `items`, at most `limit` at a time, returning when all are done. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next]!
      next += 1
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

// ---- Routes (GPX files) ----

export type Activity = 'bike' | 'hike' | 'other'

export const ACTIVITIES: {value: Activity; label: string}[] = [
  {value: 'bike', label: 'Bike'},
  {value: 'hike', label: 'Hike'},
  {value: 'other', label: 'Other'},
]

/** GPX routes, by extension (browsers report no useful type for them). */
export function isGpxFile(file: {name: string}): boolean {
  return /\.gpx$/i.test(file.name)
}

/** DJI flight logs by file name (`FlightRecord_*.txt` / `DJIFlightRecord_*.txt`). */
export function isFlightLogFile(file: {name: string}): boolean {
  return isFlightLogFileName(file.name)
}

/** Flights shorter than this are excluded from bulk upload by default (Tom can opt back in). */
export const SHORT_FLIGHT_UPLOAD_MIN_SECONDS = 60

export function isShortFlightDuration(durationSeconds: number | undefined | null): boolean {
  return (
    typeof durationSeconds === 'number' &&
    Number.isFinite(durationSeconds) &&
    durationSeconds < SHORT_FLIGHT_UPLOAD_MIN_SECONDS
  )
}

/** Undefined means included (photos/routes and normal flights). */
export function countsTowardBulkUpload(includeInUpload: boolean | undefined): boolean {
  return includeInUpload !== false
}

/** Short flights default off the map until opted in; length alone decides (not video/photo segments). */
export function defaultIncludeOnMap(
  durationSeconds: number | undefined | null,
  optedIn?: boolean,
): boolean {
  if (!isShortFlightDuration(durationSeconds)) return true
  return optedIn === true
}

/** A readable title from a file name: "Afternoon_Ride.gpx" becomes "Afternoon Ride". */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The activity, when the file says so in plain words ("cycling", "hiking"). Anything else, such as the
 * numeric codes some apps use, is left for the person to choose rather than guessed.
 */
export function guessActivity(type: string | undefined): Activity | undefined {
  if (!type) return undefined
  if (/bik|cycl|ride/i.test(type)) return 'bike'
  if (/hik|walk|trek/i.test(type)) return 'hike'
  return undefined
}

/** The Route document created for an uploaded GPX: the line, a simplified copy for the map, and its length. */
export function routeFromUpload(
  fileAssetId: string,
  route: {title: string; activity: Activity; coordinates: LngLat[]; startedAt?: string},
) {
  const {displayCoordinates, distanceMeters} = prepareRouteDisplayFields(route.coordinates)
  return {
    _type: 'track' as const,
    title: route.title.trim(),
    activity: route.activity,
    file: {_type: 'file' as const, asset: {_type: 'reference' as const, _ref: fileAssetId}},
    route: {type: 'LineString' as const, coordinates: JSON.stringify(route.coordinates)},
    displayCoordinates,
    distanceMeters,
    ...(route.startedAt ? {startedAt: route.startedAt} : {}),
  }
}

/** The Flight document created for an uploaded DJI log. */
export function flightFromUpload(
  fileAssetId: string,
  parsed: ParsedFlightLog & {title: string; sourceFilename?: string},
  includeOnMap = true,
) {
  return {
    _type: 'flight' as const,
    title: parsed.title.trim(),
    includeOnMap,
    log: {_type: 'file' as const, asset: {_type: 'reference' as const, _ref: fileAssetId}},
    displayCoordinates: parsed.displayCoordinates,
    series: parsed.series,
    distanceMeters: parsed.distanceMeters,
    durationSeconds: parsed.durationSeconds,
    maxHeightMeters: parsed.maxHeightMeters,
    aircraft: parsed.aircraft,
    ...(parsed.startedAt ? {startedAt: parsed.startedAt} : {}),
    ...(parsed.place ? {place: parsed.place} : {}),
    ...(parsed.home
      ? {home: {_type: 'geopoint' as const, lat: parsed.home.lat, lng: parsed.home.lng}}
      : {}),
    videoSegments: parsed.videoSegments,
    ...(parsed.sourceFilename ? {sourceFilename: parsed.sourceFilename} : {}),
  }
}
