import {plausibleTime} from './bulk-upload'

/** DJI Fly export: `dji_fly_YYYYMMDD_HHMMSS_…` */
const DJI_FLY = /dji_fly_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i
/** Camera roll: `DJI_YYYYMMDDHHMMSS_…` */
const DJI_STAMP = /dji_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i

function isoFromParts(y: string, mo: string, d: string, h: string, mi: string, s: string): string | undefined {
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
  return plausibleTime(date)
}

/** Guess capture time from a DJI-style file name when EXIF / `takenAt` is missing. */
export function inferTakenAtFromFileName(fileName: string | null | undefined): string | undefined {
  if (!fileName) return undefined
  const fly = fileName.match(DJI_FLY)
  if (fly) return isoFromParts(fly[1]!, fly[2]!, fly[3]!, fly[4]!, fly[5]!, fly[6]!)
  const stamp = fileName.match(DJI_STAMP)
  if (stamp) return isoFromParts(stamp[1]!, stamp[2]!, stamp[3]!, stamp[4]!, stamp[5]!, stamp[6]!)
  return undefined
}

export function effectiveTakenAt(takenAt: string | undefined, fileName: string | undefined): string | undefined {
  if (takenAt) return takenAt
  return inferTakenAtFromFileName(fileName)
}