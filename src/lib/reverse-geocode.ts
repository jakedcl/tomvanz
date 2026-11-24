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

/** ~110 m grid — good enough for takeoff labels without hammering Nominatim. */
export function geocodeCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
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

/** Prefer neighbourhoods and towns over peaks and named landmarks. */
export function pickLocalityLabel(data: NominatimReverse): string | undefined {
  const addr = data.address
  if (!addr) return shortenPlace(data.display_name)

  const localityKeys = [
    'neighbourhood',
    'suburb',
    'city_district',
    'quarter',
    'hamlet',
    'village',
    'town',
    'city',
    'municipality',
  ] as const

  for (const key of localityKeys) {
    const value = addr[key]
    if (value?.trim()) {
      const region = addr.state || addr.region
      const label = region && region !== value ? `${value}, ${region}` : value
      return shortenPlace(label)
    }
  }

  const addressType = (data.addresstype ?? data.type ?? '').toLowerCase()
  if (!LANDMARK_ADDRESS_TYPES.has(addressType) && data.name?.trim()) {
    return shortenPlace(data.name)
  }

  const county = addr.county
  const region = addr.state || addr.region
  if (county) return shortenPlace(region && county !== region ? `${county}, ${region}` : county)
  return shortenPlace(data.display_name)
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

function shortenPlace(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  let s = raw.trim()
  s = s.replace(/^\d+[\s,]+/, '')
  s = s
    .replace(/\d{1,6}\s+[\w\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi, '')
    .trim()
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`
  }
  return s.slice(0, 80)
}