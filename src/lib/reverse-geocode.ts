/**
 * Reverse-geocode a point to a short place label (no street numbers).
 * Uses OpenStreetMap Nominatim (no API key); call only from the server.
 * Serialized to ≤1 request/s with in-memory cache (Nominatim usage policy).
 */

const USER_AGENT = 'TomVanzMap/1.0 (+https://tomvanz.com)'

const cache = new Map<string, string | undefined>()
let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

const LANDMARK_ADDRESS_TYPES = new Set([
  'peak',
  'volcano',
  'mountain',
  'ridge',
  'saddle',
  'attraction',
  'viewpoint',
  'natural',
  'wood',
  'forest',
  'water',
  'lake',
])

export const NYC_BOROUGH_NAMES = new Set([
  'Bronx',
  'The Bronx',
  'Brooklyn',
  'Manhattan',
  'Queens',
  'Staten Island',
])

const MUNICIPAL_PREFIX = /^(town of|city of|village of|township of)\s+/i

/** Bump when label selection rules change so cached strings refresh. */
const GEOCODE_CACHE_VERSION = 'v3'

/** ~110 m grid — good enough for takeoff labels without hammering Nominatim. */
export function geocodeCacheKey(lat: number, lng: number): string {
  return `${GEOCODE_CACHE_VERSION}:${lat.toFixed(3)},${lng.toFixed(3)}`
}

function schedule<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt))
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequestAt = Date.now()
    return work()
  })
  queue = run.catch(() => {})
  return run
}

type NominatimReverse = {
  name?: string
  display_name?: string
  addresstype?: string
  type?: string
  address?: Record<string, string>
}

export function isCountyName(value: string): boolean {
  return /county/i.test(value.trim())
}

/** @deprecated Use isCountyName; kept for existing tests. */
export function isSkippableLocality(value: string): boolean {
  return isCountyName(value)
}

export function stripMunicipalPrefix(value: string): string {
  return value.replace(MUNICIPAL_PREFIX, '').trim()
}

/** Trim street clutter; never append region/state. */
export function normalizePlaceTitle(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  let s = stripMunicipalPrefix(raw.trim())
  s = s.replace(/^\d+[\s,]+/, '')
  s = s
    .replace(/\d{1,6}\s+[\w\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi, '')
    .trim()
  const first = s.split(',')[0]?.trim()
  if (!first || isCountyName(first)) return undefined
  return first.slice(0, 80)
}

function acceptPlaceName(raw: string): string | undefined {
  return normalizePlaceTitle(raw)
}

/** Single-name place title (no state, no county) for auto-titles and `place` fields. */
export function placeTitleFromAddress(addr: Record<string, string>): string | undefined {
  for (const key of ['neighbourhood', 'quarter'] as const) {
    const value = addr[key]?.trim()
    if (!value) continue
    const title = acceptPlaceName(value)
    if (title) return title
  }

  const suburb = addr.suburb?.trim()
  if (suburb && !isCountyName(suburb) && !NYC_BOROUGH_NAMES.has(suburb)) {
    const title = acceptPlaceName(suburb)
    if (title) return title
  }

  for (const key of ['village'] as const) {
    const value = addr[key]?.trim()
    if (!value) continue
    const title = acceptPlaceName(value)
    if (title) return title
  }

  const town = addr.town?.trim()
  if (town) {
    const title = acceptPlaceName(town)
    if (title) return title
  }

  const hamlet = addr.hamlet?.trim()
  if (hamlet) {
    const title = acceptPlaceName(hamlet)
    if (title) return title
  }

  for (const key of ['suburb', 'city_district', 'borough', 'city'] as const) {
    const value = addr[key]?.trim()
    if (!value || !NYC_BOROUGH_NAMES.has(value)) continue
    const title = acceptPlaceName(value)
    if (title) return title
  }

  for (const key of ['city', 'municipality'] as const) {
    const value = addr[key]?.trim()
    if (!value) continue
    const title = acceptPlaceName(value)
    if (title) return title
  }

  return undefined
}

/** Pick the most specific neighbourhood/town name from a Nominatim reverse payload. */
export function pickLocalityLabel(data: NominatimReverse): string | undefined {
  const addr = data.address
  if (addr) {
    const fromAddr = placeTitleFromAddress(addr)
    if (fromAddr) return fromAddr
  }

  const addressType = (data.addresstype ?? data.type ?? '').toLowerCase()
  if (!LANDMARK_ADDRESS_TYPES.has(addressType) && data.name?.trim()) {
    const title = acceptPlaceName(data.name)
    if (title) return title
  }

  return fallbackFromDisplayName(data.display_name)
}

function fallbackFromDisplayName(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const first = raw.split(',')[0]?.trim()
  if (!first) return undefined
  return acceptPlaceName(first)
}

export async function reverseGeocodePlace(lat: number, lng: number): Promise<string | undefined> {
  const key = geocodeCacheKey(lat, lng)
  const cached = cache.get(key)
  if (cached) return cached

  const result = await schedule(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/reverse')
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lng))
    url.searchParams.set('format', 'json')
    url.searchParams.set('zoom', '14')
    url.searchParams.set('addressdetails', '1')

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return undefined
    const data = (await response.json()) as NominatimReverse
    return pickLocalityLabel(data)
  })

  if (result) cache.set(key, result)
  return result
}