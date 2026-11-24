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

/** Most specific first; names with County / NYC borough admin labels are skipped when a finer field exists. */
export const LOCALITY_KEYS = [
  'neighbourhood',
  'quarter',
  'hamlet',
  'suburb',
  'village',
  'town',
  'city_district',
  'city',
  'municipality',
] as const

const NYC_BOROUGH_LABELS = new Set([
  'Bronx',
  'The Bronx',
  'Brooklyn',
  'Manhattan',
  'Queens',
  'Staten Island',
  'Richmond County',
  'Kings County',
  'New York County',
  'Bronx County',
  'Queens County',
])

/** County-level or borough admin names — not used as auto-titles when a finer locality exists. */
export function isSkippableLocality(value: string, key?: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/county/i.test(trimmed)) return true
  if (key === 'city_district' && NYC_BOROUGH_LABELS.has(trimmed)) return true
  if (NYC_BOROUGH_LABELS.has(trimmed) && key === 'suburb') return true
  return false
}

/** Bump when label selection rules change so cached strings refresh. */
const GEOCODE_CACHE_VERSION = 'v2'

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

/** Single-name place title (no state, no county) for auto-titles and `place` fields. */
export function placeTitleFromAddress(addr: Record<string, string>): string | undefined {
  for (const key of LOCALITY_KEYS) {
    const value = addr[key]?.trim()
    if (!value || isSkippableLocality(value, key)) continue
    return normalizePlaceTitle(value)
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
    const name = data.name.trim()
    if (!isSkippableLocality(name)) return normalizePlaceTitle(name)
  }

  return fallbackFromDisplayName(data.display_name)
}

function fallbackFromDisplayName(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const first = raw.split(',')[0]?.trim()
  if (!first || isSkippableLocality(first)) return undefined
  return normalizePlaceTitle(first)
}

/** Trim street clutter; never append region/state. */
export function normalizePlaceTitle(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  let s = raw.trim()
  s = s.replace(/^\d+[\s,]+/, '')
  s = s
    .replace(/\d{1,6}\s+[\w\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi, '')
    .trim()
  const first = s.split(',')[0]?.trim()
  return first ? first.slice(0, 80) : undefined
}

export async function reverseGeocodePlace(lat: number, lng: number): Promise<string | undefined> {
  const key = geocodeCacheKey(lat, lng)
  if (cache.has(key)) return cache.get(key)

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

  cache.set(key, result)
  return result
}