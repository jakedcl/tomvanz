import {plausibleTime} from './plausible-time.ts'

/** DJI Fly export: `dji_fly_YYYYMMDD_HHMMSS_…` (local America/New_York). */
const DJI_FLY = /dji_fly_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i
/** Camera roll: `DJI_YYYYMMDDHHMMSS_…` (local America/New_York). */
const DJI_STAMP = /dji_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/

/** US Eastern: DST from second Sunday in March through first Sunday in November. */
export function isUsEasternDaylightTime(year: number, month: number, day: number): boolean {
  if (month < 3 || month > 11) return false
  if (month > 3 && month < 11) return true
  const nthSunday = (y: number, m: number, n: number) => {
    const first = new Date(Date.UTC(y, m - 1, 1))
    const dow = first.getUTCDay()
    const firstSun = 1 + ((7 - dow) % 7)
    return firstSun + (n - 1) * 7
  }
  if (month === 3) return day >= nthSunday(year, 3, 2)
  return day < nthSunday(year, 11, 1)
}

/** Local civil time in America/New_York → UTC ISO string. */
export function easternLocalToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string | undefined {
  const offsetMinutes = isUsEasternDaylightTime(year, month, day) ? 4 * 60 : 5 * 60
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) + offsetMinutes * 60_000
  return plausibleTime(new Date(utcMs))
}

export function parseExifCivilParts(
  value: string,
): [number, number, number, number, number, number] | undefined {
  const match = value.trim().match(EXIF_DATE)
  if (!match) return undefined
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ]
}

/** EXIF `±HH:MM` offset applied to a civil timestamp (no Z). */
export function takenAtWithExifOffsetParts(
  parts: [number, number, number, number, number, number],
  offset: string,
): string | undefined {
  const trimmed = offset.trim()
  const match = trimmed.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const sign = match[1] === '-' ? -1 : 1
  const offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]))
  const [y, mo, d, h, mi, s] = parts
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - offsetMinutes * 60_000
  return plausibleTime(new Date(utcMs))
}

/**
 * Sanity / EXIF `YYYY:MM:DD HH:mm:ss` with no timezone → Eastern local (site content is NY-area).
 * Never treats civil clock fields as UTC.
 */
export function takenAtFromExifDateTime(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  const parts = parseExifCivilParts(value)
  if (!parts) return undefined
  const [y, mo, d, h, mi, s] = parts
  return easternLocalToUtcIso(y, mo, d, h, mi, s)
}

/** Guess capture time from a DJI-style file name when EXIF / `takenAt` is missing. */
export function inferTakenAtFromFileName(fileName: string | null | undefined): string | undefined {
  if (!fileName) return undefined
  const fly = fileName.match(DJI_FLY)
  if (fly) {
    return easternLocalToUtcIso(
      Number(fly[1]),
      Number(fly[2]),
      Number(fly[3]),
      Number(fly[4]),
      Number(fly[5]),
      Number(fly[6]),
    )
  }
  const stamp = fileName.match(DJI_STAMP)
  if (stamp) {
    return easternLocalToUtcIso(
      Number(stamp[1]),
      Number(stamp[2]),
      Number(stamp[3]),
      Number(stamp[4]),
      Number(stamp[5]),
      Number(stamp[6]),
    )
  }
  return undefined
}

export type TakenAtSources = {
  takenAt?: string
  fileName?: string
  exifDateTimeOriginal?: string
}

export function effectiveTakenAt(
  takenAt: string | undefined,
  fileName: string | undefined,
  exifDateTimeOriginal?: string,
): string | undefined {
  if (takenAt) return takenAt
  const fromFile = inferTakenAtFromFileName(fileName)
  if (fromFile) return fromFile
  return takenAtFromExifDateTime(exifDateTimeOriginal)
}

/** DJI EXIF DateTimeOriginal without OffsetTime* → Eastern, not UTC. */
export function djiExifDateTimeOriginalToIso(value: string): string | undefined {
  return takenAtFromExifDateTime(value)
}