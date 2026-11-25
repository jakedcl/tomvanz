import exifr from 'exifr'

import {isDroneFileName} from './drone'
import {plausibleTime} from './plausible-time'
import {takenAtFromExifDateTime} from './photo-taken-at'

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
  xmp: false,
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

/** Apply EXIF `±HH:MM` offset to a civil-time instant encoded as UTC ms (no zone in tag). */
export function takenAtWithExifOffset(
  when: Date | string | undefined,
  offset: string | undefined,
): string | undefined {
  if (!when) return undefined
  const date = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(date.getTime())) return takenAtFromExifDateTime(String(when))
  const minutes = offsetMinutes(offset)
  if (minutes == null) return plausibleTime(date)
  const civilUtcMs = date.getTime()
  const actualUtcMs = civilUtcMs - minutes * 60_000
  return plausibleTime(new Date(actualUtcMs))
}

function exifTakenAt(data: Record<string, unknown>): string | undefined {
  const offset = (data.OffsetTimeOriginal ?? data.OffsetTimeDigitized) as string | undefined
  const original = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate
  if (original instanceof Date) return takenAtWithExifOffset(original, offset)
  if (typeof original === 'string') {
    const fromString = takenAtFromExifDateTime(original)
    if (fromString && offset) {
      const asDate = new Date(fromString)
      if (!Number.isNaN(asDate.getTime())) return takenAtWithExifOffset(asDate, offset)
    }
    return fromString
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

/**
 * Reads GPS, capture time (with EXIF timezone when available), and camera fields from a photo file.
 */
export async function readPhotoMeta(input: Blob | ArrayBuffer | Uint8Array): Promise<PhotoMeta> {
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

  const takenAt = exifTakenAt(data)
  if (takenAt) meta.takenAt = takenAt

  const make = typeof data.Make === 'string' ? data.Make.trim() : undefined
  const model = typeof data.Model === 'string' ? data.Model.trim() : undefined
  if (make) meta.cameraMake = make
  if (model) meta.cameraModel = model

  return meta
}

/** Altitude for storage — only when the file looks like a drone capture. */
export function droneAltitudeFromExif(
  fileName: string | undefined,
  data: {GPSAltitude?: unknown; GPSAltitudeRef?: unknown},
): number | undefined {
  if (!isDroneFileName(fileName)) return undefined
  return gpsAltitudeMeters(data.GPSAltitude, data.GPSAltitudeRef)
}

/**
 * Same as {@link readPhotoMeta} but includes drone-only altitude when the file name is DJI-style.
 */
export async function readPhotoMetaWithAltitude(
  input: Blob | ArrayBuffer | Uint8Array,
  fileName?: string,
): Promise<PhotoMeta> {
  const meta = await readPhotoMeta(input)
  if (!fileName) return meta
  try {
    const raw = (await exifr.parse(input, {gps: true, pick: ['GPSAltitude', 'GPSAltitudeRef']})) ?? {}
    const alt = droneAltitudeFromExif(fileName, raw)
    if (alt != null) meta.altitudeMeters = alt
  } catch {
    // ignore
  }
  return meta
}

/** Options for Sanity image asset uploads so location and EXIF land on the asset. */
export const SANITY_IMAGE_EXTRACT = ['exif', 'location'] as const
