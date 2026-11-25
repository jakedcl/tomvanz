import {isDroneFileName} from './drone'
import {isFlightLogFileName, type ParsedFlightLog} from './flight-log'
import {type PhotoMeta, readPhotoMetaWithAltitude} from './photo-exif'
import {prepareRouteDisplayFields, type LngLat} from './simplify-route'

export {plausibleTime} from './plausible-time'
export type {PhotoMeta} from './photo-exif'
export {readPhotoMeta, SANITY_IMAGE_EXTRACT} from './photo-exif'

/** Reads EXIF for bulk upload (includes drone altitude when applicable). */
export async function readPhotoMetaFromFile(file: File): Promise<PhotoMeta> {
  return readPhotoMetaWithAltitude(file, file.name)
}

const PHOTO_EXTENSIONS = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i

/** Photos only: by MIME type, or by extension when the browser doesn't report one. */
export function isPhotoFile(file: {name: string; type: string}): boolean {
  return file.type.startsWith('image/') || PHOTO_EXTENSIONS.test(file.name)
}

/** The Photo document created for an uploaded picture. The title is optional and left out when blank. */
export function photoFromUpload(assetId: string, meta: PhotoMeta, title?: string, fileName?: string) {
  const cleanTitle = title?.trim()
  const drone = fileName ? isDroneFileName(fileName) : undefined
  return {
    _type: 'photo' as const,
    ...(cleanTitle ? {title: cleanTitle} : {}),
    image: {_type: 'image' as const, asset: {_type: 'reference' as const, _ref: assetId}},
    ...(meta.lat != null && meta.lng != null
      ? {location: {_type: 'geopoint' as const, lat: meta.lat, lng: meta.lng}}
      : {}),
    ...(meta.takenAt ? {takenAt: meta.takenAt} : {}),
    ...(meta.cameraMake ? {cameraMake: meta.cameraMake} : {}),
    ...(meta.cameraModel ? {cameraModel: meta.cameraModel} : {}),
    ...(drone === true ? {drone: true} : {}),
    ...(drone && meta.altitudeMeters != null ? {altitudeMeters: meta.altitudeMeters} : {}),
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
  route: {title: string; activity: Activity; coordinates: LngLat[]; startedAt?: string; endedAt?: string},
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
    ...(route.endedAt ? {endedAt: route.endedAt} : {}),
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
    ...(parsed.aircraftSerial ? {aircraftSerial: parsed.aircraftSerial} : {}),
    ...(parsed.startedAt ? {startedAt: parsed.startedAt} : {}),
    ...(parsed.endedAt ? {endedAt: parsed.endedAt} : {}),
    ...(parsed.place ? {place: parsed.place} : {}),
    ...(parsed.home
      ? {home: {_type: 'geopoint' as const, lat: parsed.home.lat, lng: parsed.home.lng}}
      : {}),
    videoSegments: parsed.videoSegments,
    ...(parsed.sourceFilename ? {sourceFilename: parsed.sourceFilename} : {}),
  }
}
