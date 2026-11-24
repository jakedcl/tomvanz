const MIN_SPACING_MS = 1100
const RETRY_DELAY_MS = 1500

let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function scheduleClientGeocode<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_SPACING_MS - (Date.now() - lastRequestAt))
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
    return work()
  })
  queue = run.catch(() => {})
  return run
}

type GeocodeAttempt = {
  place?: string
  shouldRetry: boolean
  fatal?: string
}

async function geocodeAttempt(lat: number, lng: number, bearerToken: string): Promise<GeocodeAttempt> {
  const res = await fetch('/api/reverse-geocode', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({lat, lng}),
  })

  let data: {place?: string; error?: string} = {}
  try {
    data = (await res.json()) as {place?: string; error?: string}
  } catch {
  }

  if (res.status === 429 || res.status >= 500) {
    return {shouldRetry: true}
  }

  if (!res.ok) {
    return {shouldRetry: false, fatal: data.error ?? 'Could not look up that place.'}
  }

  const place = data.place?.trim()
  if (!place) return {shouldRetry: true}
  return {shouldRetry: false, place}
}

/** Client helper for `POST /api/reverse-geocode` — serialized ≥1.1s apart with one retry. */
export async function postReverseGeocodePlace(
  lat: number,
  lng: number,
  bearerToken: string,
): Promise<string | undefined> {
  return scheduleClientGeocode(async () => {
    let attempt = await geocodeAttempt(lat, lng, bearerToken)
    if (attempt.fatal) throw new Error(attempt.fatal)
    if (attempt.shouldRetry) {
      await sleep(RETRY_DELAY_MS)
      attempt = await geocodeAttempt(lat, lng, bearerToken)
      if (attempt.fatal) throw new Error(attempt.fatal)
    }
    return attempt.place
  })
}