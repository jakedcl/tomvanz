/**
 * Reverse-geocode a point to a short place label (no street numbers).
 * Uses OpenStreetMap Nominatim (no API key); call only from the server.
 */
export async function reverseGeocodePlace(lat: number, lng: number): Promise<string | undefined> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lng))
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '14')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'tomvanz.com/1.0 (map site; contact: studio)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) return undefined

  const data = (await response.json()) as {address?: Record<string, string>; display_name?: string}
  const addr = data.address
  if (!addr) return shortenPlace(data.display_name)

  const locality =
    addr.neighbourhood ||
    addr.suburb ||
    addr.village ||
    addr.hamlet ||
    addr.town ||
    addr.city ||
    addr.municipality ||
    addr.county
  const region = addr.state || addr.region
  const label = [locality, region].filter(Boolean).join(', ')
  return shortenPlace(label || data.display_name)
}

function shortenPlace(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  let s = raw.trim()
  s = s.replace(/^\d+[\s,]+/, '')
  s = s.replace(/\d{1,6}\s+[\w\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi, '').trim()
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`
  }
  return s.slice(0, 80)
}