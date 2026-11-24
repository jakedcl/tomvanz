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
): Record<string, unknown> {
  return {
    title: parsed.defaultTitle,
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