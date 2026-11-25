import exifr from 'exifr'

import {aircraftFromCameraModel} from './dji-camera'
import {isDroneFileName} from './drone'
import {
  easternLocalToUtcIso,
  parseExifCivilParts,
  takenAtFromExifDateTime,
  takenAtWithExifOffsetParts,
} from './photo-taken-at'
import {plausibleTime} from './plausible-time'

/** EXIF fields saved on Photo documents and used for auto-linking. */
export type PhotoMeta = {
  lat?: number
  lng?: number
  takenAt?: string
  cameraMake?: string
  cameraModel?: string
  /** Relative GPS altitude when present; stored only for drone photos. */
  altitudeMeters?: number
}

const EXIF_OPTIONS = {
  gps: true,
  reviveValues: true,
  ifd1: false,
  iptc: false,
  xmp: true,
  icc: false,
  jfif: false,
} as const

function offsetMinutes(offset: string | undefined): number | undefined {
  if (!offset || typeof offset !== 'string') return undefined
  const match = offset.trim().match(/^([+-])(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

function isDjiExif(make: unknown, model: unknown, fileName?: string): boolean {
  const m = String(make ?? '').toLowerCase()
  const mod = String(model ?? '').toUpperCase()
  return (
    isDroneFileName(fileName) ||
    m.includes('dji') ||
    Boolean(aircraftFromCameraModel(mod)) ||
    /^FC\d+/i.test(String(model ?? ''))
  )
}

function partsFromExifValue(original: unknown): [number, number, number, number, number, number] | undefined {
  if (typeof original === 'string') return parseExifCivilParts(original)
  if (original instanceof Date && !Number.isNaN(original.getTime())) {
    return [
      original.getFullYear(),
      original.getMonth() + 1,
      original.getDate(),
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
    ]
  }
  return undefined
}

function exifTakenAt(data: Record<string, unknown>, fileName?: string): string | undefined {
  const offset = (data.OffsetTimeOriginal ?? data.OffsetTimeDigitized ?? data.OffsetTime) as
    | string
    | undefined
  const original = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate

  const parts = partsFromExifValue(original)
  if (parts) {
    if (offset) {
      const withOffset = takenAtWithExifOffsetParts(parts, offset)
      if (withOffset) return withOffset
    }
    const [y, mo, d, h, mi, s] = parts
    return easternLocalToUtcIso(y, mo, d, h, mi, s)
  }

  if (typeof original === 'string') {
    if (offset && offsetMinutes(offset) != null) {
      const civil = parseExifCivilParts(original)
      if (civil) return takenAtWithExifOffsetParts(civil, offset)
    }
    if (isDjiExif(data.Make, data.Model, fileName)) {
      return takenAtFromExifDateTime(original)
    }
    return takenAtFromExifDateTime(original)
  }

  return undefined
}

function gpsAltitudeMeters(altitude: unknown, ref: unknown): number | undefined {
  const value = Number(altitude)
  if (!Number.isFinite(value)) return undefined
  const belowSea = ref === 1 || ref === '1'
  const meters = belowSea ? -value : value
  return Number.isFinite(meters) ? Math.round(meters * 10) / 10 : undefined
}

function droneAltitudeFromData(data: Record<string, unknown>): number | undefined {
  for (const key of [
    'RelativeAltitude',
    'relativeAltitude',
    'drone-dji:RelativeAltitude',
    'GimbalRelativeAltitude',
  ]) {
    const v = Number(data[key])
    if (Number.isFinite(v)) return Math.round(v * 10) / 10
  }
  return gpsAltitudeMeters(data.GPSAltitude, data.GPSAltitudeRef)
}

/**
 * Reads GPS, capture time (with EXIF timezone when available), and camera fields from a photo file.
 */
export async function readPhotoMeta(
  input: Blob | ArrayBuffer | Uint8Array,
  fileName?: string,
): Promise<PhotoMeta> {
  let data: Record<string, unknown> | undefined
  try {
    data = (await exifr.parse(input, EXIF_OPTIONS)) ?? undefined
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

  const takenAt = exifTakenAt(data, fileName)
  if (takenAt) meta.takenAt = takenAt

  const make = typeof data.Make === 'string' ? data.Make.trim() : undefined
  const model = typeof data.Model === 'string' ? data.Model.trim() : undefined
  if (make) meta.cameraMake = make
  if (model) meta.cameraModel = model

  return meta
}

/**
 * Same as {@link readPhotoMeta} but includes drone-only altitude when the file looks like a drone capture.
 */
export async function readPhotoMetaWithAltitude(
  input: Blob | ArrayBuffer | Uint8Array,
  fileName?: string,
): Promise<PhotoMeta> {
  const meta = await readPhotoMeta(input, fileName)
  if (!fileName) return meta
  let data: Record<string, unknown> | undefined
  try {
    data = (await exifr.parse(input, EXIF_OPTIONS)) ?? undefined
  } catch {
    return meta
  }
  if (!data) return meta
  if (!isDjiExif(data.Make, data.Model, fileName) && !isDroneFileName(fileName)) return meta
  const alt = droneAltitudeFromData(data)
  if (alt != null) meta.altitudeMeters = alt
  return meta
}

/** Options for Sanity image asset uploads so location and EXIF land on the asset. */
export const SANITY_IMAGE_EXTRACT = ['exif', 'location'] as const