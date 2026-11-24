import {titleFromFileName} from './bulk-upload'

/** Map/doc title from reverse-geocoded locality only (no date). */
export function placeAutoTitle(place: string | undefined, fallback: string): string {
  const trimmed = place?.trim()
  return trimmed || fallback
}

/** Do not replace a title the editor already typed. */
export function patchTitleIfEmpty(
  currentTitle: string | undefined,
  suggested: string | undefined,
): {title?: string} {
  if (currentTitle?.trim()) return {}
  const next = suggested?.trim()
  return next ? {title: next} : {}
}

export function routeTitleFallback(gpxName: string | undefined, fileName: string): string {
  return (gpxName?.trim() || titleFromFileName(fileName)).trim()
}

export function photoTitleFallback(fileName: string): string {
  return titleFromFileName(fileName)
}

export async function titleFromCoordinates(
  lat: number,
  lng: number,
  lookupPlace: (lat: number, lng: number) => Promise<string | undefined>,
  fallback: string,
): Promise<string> {
  try {
    const place = await lookupPlace(lat, lng)
    if (place?.trim()) return place.trim()
  } catch {
    // Geocode failure or network — keep filename / GPX name fallback.
  }
  return fallback
}