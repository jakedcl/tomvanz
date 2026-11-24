import {DJILog, type Frame, type KeychainFeaturePoint} from 'dji-log-parser-js'

import {lineLengthMeters, prepareRouteDisplayFields, type LngLat} from './simplify-route'

export type FlightSeriesSample = {
  /** Seconds from flight start. */
  t: number
  lng: number
  lat: number
  /** Height above takeoff / AGL (m). */
  height: number
  /** Horizontal speed m/s. */
  speed: number
  /** Aircraft heading, degrees. */
  heading: number
  gimbalPitch: number
  battery: number
  mode: string
}

export type VideoSegment = {startSeconds: number; endSeconds: number}

export type ParsedFlightLog = {
  startedAt?: string
  durationSeconds: number
  distanceMeters: number
  maxHeightMeters: number
  aircraft: string
  displayCoordinates: string
  series: string
  videoSegments: VideoSegment[]
  hasGps: boolean
  home?: {lat: number; lng: number}
  place?: string
  defaultTitle: string
}

const FLIGHT_LOG_NAME =
  /^(?:FlightRecord_|DJIFlightRecord_).+\.txt$/i

/** DJI flight logs by canonical file name (random `.txt` files are ignored in bulk upload). */
export function isFlightLogFileName(name: string): boolean {
  return FLIGHT_LOG_NAME.test(name)
}

const VALID_GPS = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(lat === 0 && lng === 0)

function flightModeLabel(mode: Frame['osd']['flycState']): string {
  if (mode == null) return ''
  if (typeof mode === 'string') return mode
  if (typeof mode === 'object' && 'Unknown' in mode) return `Mode ${mode.Unknown}`
  return String(mode)
}

function productLabel(details: {aircraftName?: string; productType?: unknown}): string {
  const name = details.aircraftName?.trim()
  if (name) return name
  const pt = details.productType
  if (typeof pt === 'string') return pt.replace(/([a-z])([A-Z])/g, '$1 $2')
  return 'DJI drone'
}

function parseStartTime(details: DetailsLike, firstFlyTime: number, firstFrameDate?: string): string | undefined {
  const raw = details.startTime?.trim()
  if (raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2005) return d.toISOString()
  }
  if (firstFrameDate) {
    const d = new Date(firstFrameDate)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2005 && d.getFullYear() < 2100) {
      if (d.getFullYear() === 1970 && firstFlyTime > 0) {
        return undefined
      }
      return d.toISOString()
    }
  }
  return undefined
}

type DetailsLike = {startTime?: string; aircraftName?: string; productType?: unknown; latitude?: number; longitude?: number}

function frameTimeSeconds(frame: Frame, startMs: number | null): number | null {
  const flyTime = frame.osd?.flyTime
  if (typeof flyTime === 'number' && Number.isFinite(flyTime)) return flyTime
  const dt = frame.custom?.dateTime
  if (dt && startMs != null) {
    const ms = new Date(dt).getTime()
    if (Number.isFinite(ms)) return (ms - startMs) / 1000
  }
  return null
}

function horizontalSpeed(osd: Frame['osd']): number {
  const x = osd?.xSpeed ?? 0
  const y = osd?.ySpeed ?? 0
  return Math.hypot(x, y)
}

/** Drop single-frame spikes in gimbal pitch and ground speed. */
function spikeFilter(samples: FlightSeriesSample[]): FlightSeriesSample[] {
  if (samples.length < 3) return samples
  const out: FlightSeriesSample[] = []
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!
    const prev = samples[i - 1]
    const next = samples[i + 1]
    let pitch = s.gimbalPitch
    let speed = s.speed
    if (prev && next) {
      if (Math.abs(s.gimbalPitch - prev.gimbalPitch) > 45 && Math.abs(s.gimbalPitch - next.gimbalPitch) > 45) {
        pitch = (prev.gimbalPitch + next.gimbalPitch) / 2
      }
      if (s.speed > 25 && prev.speed < 15 && next.speed < 15) {
        speed = (prev.speed + next.speed) / 2
      }
    }
    out.push({...s, gimbalPitch: pitch, speed})
  }
  return out
}

function downsampleToHz(samples: FlightSeriesSample[], hz = 1): FlightSeriesSample[] {
  if (samples.length === 0) return []
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const out: FlightSeriesSample[] = []
  let nextBucket = Math.floor(sorted[0]!.t)
  for (const s of sorted) {
    if (s.t >= nextBucket) {
      out.push(s)
      nextBucket += hz
    }
  }
  return out
}

function extractVideoSegments(frames: Frame[]): VideoSegment[] {
  const segments: VideoSegment[] = []
  let recording = false
  let start = 0
  for (const frame of frames) {
    const t = frame.osd?.flyTime
    if (typeof t !== 'number') continue
    const isVideo = frame.camera?.isVideo === true
    if (isVideo && !recording) {
      recording = true
      start = t
    } else if (!isVideo && recording) {
      recording = false
      if (t > start) segments.push({startSeconds: start, endSeconds: t})
    }
  }
  if (recording) {
    const last = frames[frames.length - 1]?.osd?.flyTime
    if (typeof last === 'number' && last > start) segments.push({startSeconds: start, endSeconds: last})
  }
  return segments
}

export async function parseFlightLogBytes(
  bytes: Uint8Array,
  options: {djiApiKey?: string; place?: string; startedAtForTitle?: string},
): Promise<ParsedFlightLog> {
  const parser = new DJILog(bytes)
  let frames: Frame[] = []
  if (parser.version >= 13) {
    const key = options.djiApiKey?.trim()
    if (!key) {
      throw new Error('Encrypted DJI log (v13+). Set DJI_API_KEY on the server to parse it.')
    }
    const keychains = (await parser.fetchKeychains(key)) as KeychainFeaturePoint[][]
    frames = parser.frames(keychains)
  } else {
    frames = parser.frames()
  }

  const details = parser.details
  const track: LngLat[] = []
  const rawSamples: FlightSeriesSample[] = []
  let startMs: number | null = null
  let firstFrameDate: string | undefined
  let maxHeight = 0

  for (const frame of frames) {
    const lat = frame.osd?.latitude
    const lng = frame.osd?.longitude
    if (!VALID_GPS(lat, lng)) continue

    const dt = frame.custom?.dateTime
    if (dt && !firstFrameDate) firstFrameDate = dt
    if (dt && startMs == null) {
      const ms = new Date(dt).getTime()
      if (Number.isFinite(ms) && new Date(dt).getFullYear() !== 1970) startMs = ms
    }

    const t = frameTimeSeconds(frame, startMs)
    if (t == null) continue

    const height = frame.osd?.height ?? 0
    if (height > maxHeight) maxHeight = height

    track.push([lng, lat])
    rawSamples.push({
      t,
      lng,
      lat,
      height,
      speed: horizontalSpeed(frame.osd),
      heading: frame.osd?.yaw ?? 0,
      gimbalPitch: frame.gimbal?.pitch ?? 0,
      battery: frame.battery?.chargeLevel ?? 0,
      mode: flightModeLabel(frame.osd?.flycState),
    })
  }

  const hasGps = track.length >= 2
  const durationSeconds =
    rawSamples.length > 0 ? Math.max(...rawSamples.map((s) => s.t)) : (details.totalTime ?? 0)
  const distanceMeters = hasGps ? lineLengthMeters(track) : 0
  const {displayCoordinates} = hasGps
    ? prepareRouteDisplayFields(track)
    : {displayCoordinates: '[]'}

  const seriesSamples = spikeFilter(downsampleToHz(rawSamples))
  const startedAt =
    parseStartTime(details, rawSamples[0]?.t ?? 0, firstFrameDate) ??
    (options.startedAtForTitle ? undefined : undefined)

  let startedAtResolved = startedAt
  if (!startedAtResolved && firstFrameDate) {
    const d = new Date(firstFrameDate)
    if (d.getFullYear() === 1970 && details.startTime) {
      const base = new Date(details.startTime)
      if (!Number.isNaN(base.getTime()) && rawSamples[0]) {
        startedAtResolved = new Date(base.getTime() + rawSamples[0].t * 1000).toISOString()
      }
    }
  }
  if (!startedAtResolved && details.startTime) {
    const d = new Date(details.startTime)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2005) startedAtResolved = d.toISOString()
  }

  const aircraft = productLabel(details)
  const home =
    details.latitude != null &&
    details.longitude != null &&
    VALID_GPS(details.latitude, details.longitude)
      ? {lat: details.latitude, lng: details.longitude}
      : undefined

  const defaultTitle = formatDefaultTitle(startedAtResolved, options.place)

  return {
    startedAt: startedAtResolved,
    durationSeconds: Math.round(durationSeconds),
    distanceMeters,
    maxHeightMeters: Math.round(maxHeight),
    aircraft,
    displayCoordinates,
    series: JSON.stringify(seriesSamples),
    videoSegments: extractVideoSegments(frames),
    hasGps,
    home,
    place: options.place,
    defaultTitle,
  }
}

export function formatDefaultTitle(startedAt?: string, place?: string): string {
  const parts: string[] = []
  if (startedAt) {
    const d = new Date(startedAt)
    if (!Number.isNaN(d.getTime())) {
      parts.push(
        d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}),
      )
    }
  }
  if (place?.trim()) parts.push(place.trim())
  return parts.join(' · ') || 'Flight'
}

/** Quick check that a buffer is a DJI log (not an arbitrary text file). */
export function looksLikeDjiLog(bytes: Uint8Array): boolean {
  try {
    const parser = new DJILog(bytes)
    return parser.version > 0 && parser.version < 100
  } catch {
    return false
  }
}