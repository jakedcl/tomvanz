import {patchTitleIfEmpty} from './auto-title'
import {defaultIncludeOnMap} from './bulk-upload'
import {formatDefaultTitle} from './flight-log'
import type {VideoSegment} from './flight-log'

/** JSON body from `POST /api/parse-flight` (and the shape bulk upload expects). */
export type ParseFlightApiResponse = {
  defaultTitle: string
  startedAt?: string
  place?: string
  durationSeconds: number
  distanceMeters: number
  maxHeightMeters: number
  aircraft: string
  displayCoordinates: string
  series: string
  videoSegments: VideoSegment[]
  home?: {lat: number; lng: number}
  noMap?: boolean
  sourceFilename?: string
}

/** Sanity `patch().set(...)` fields derived from a parsed DJI log (excludes the log file ref). */
export function flightStudioPatchFromParse(
  parsed: ParseFlightApiResponse,
  sourceFilename: string,
  existingTitle?: string,
  includeOnMap?: boolean,
): Record<string, unknown> {
  return {
    ...patchTitleIfEmpty(existingTitle, parsed.defaultTitle),
    includeOnMap: defaultIncludeOnMap(parsed.durationSeconds, includeOnMap),
    ...(parsed.startedAt ? {startedAt: parsed.startedAt} : {}),
    ...(parsed.place ? {place: parsed.place} : {}),
    durationSeconds: parsed.durationSeconds,
    distanceMeters: parsed.distanceMeters,
    maxHeightMeters: parsed.maxHeightMeters,
    aircraft: parsed.aircraft,
    displayCoordinates: parsed.displayCoordinates,
    series: parsed.series,
    videoSegments: parsed.videoSegments,
    sourceFilename,
    ...(parsed.home
      ? {home: {_type: 'geopoint' as const, lat: parsed.home.lat, lng: parsed.home.lng}}
      : {}),
  }
}

export function flightParseGeocodePoint(parsed: ParseFlightApiResponse): {lat: number; lng: number} | null {
  if (parsed.home?.lat != null && parsed.home?.lng != null) {
    return {lat: parsed.home.lat, lng: parsed.home.lng}
  }
  try {
    const coords = JSON.parse(parsed.displayCoordinates) as [number, number][]
    const first = coords[0]
    if (first?.length === 2) return {lat: first[1]!, lng: first[0]!}
  } catch {
    // ignore bad JSON
  }
  return null
}

export function needsClientPlaceFallback(parsed: ParseFlightApiResponse): boolean {
  return !parsed.place?.trim() || parsed.defaultTitle === 'Flight'
}

/** When server parse omitted place (Nominatim race), geocode via the Studio client queue. */
export async function enrichParseFlightPlace(
  parsed: ParseFlightApiResponse,
  geocode: (lat: number, lng: number) => Promise<string | undefined>,
): Promise<ParseFlightApiResponse> {
  if (!needsClientPlaceFallback(parsed)) return parsed
  const point = flightParseGeocodePoint(parsed)
  if (!point) return parsed
  const place = await geocode(point.lat, point.lng)
  if (!place?.trim()) return parsed
  const defaultTitle = formatDefaultTitle(place)
  return {...parsed, place, defaultTitle}
}

export async function postParseFlight(file: File, bearerToken: string): Promise<ParseFlightApiResponse> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/parse-flight', {
    method: 'POST',
    headers: {Authorization: `Bearer ${bearerToken}`},
    body,
  })
  const data = (await res.json()) as ParseFlightApiResponse & {error?: string}
  if (!res.ok) throw new Error(data.error ?? 'Could not parse that flight log.')
  return data
}