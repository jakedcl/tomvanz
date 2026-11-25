import {plausibleTime} from './plausible-time.ts'

/** DJI Fly export: `dji_fly_YYYYMMDD_HHMMSS_…` (local America/New_York). */
const DJI_FLY = /dji_fly_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i
/** Camera roll: `DJI_YYYYMMDDHHMMSS_…` */
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

function isoFromUtcParts(y: string, mo: string, d: string, h: string, mi: string, s: string): string | undefined {
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
  return plausibleTime(date)
}

/** Sanity / EXIF `YYYY:MM:DD HH:mm:ss` (no timezone) → ISO. */
export function takenAtFromExifDateTime(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  const match = value.trim().match(EXIF_DATE)
  if (!match) return plausibleTime(new Date(value))
  return isoFromUtcParts(match[1]!, match[2]!, match[3]!, match[4]!, match[5]!, match[6]!)
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
  if (stamp) return isoFromUtcParts(stamp[1]!, stamp[2]!, stamp[3]!, stamp[4]!, stamp[5]!, stamp[6]!)
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