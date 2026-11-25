import type {Point3} from './track3d'

/** Flights asked for per request (the server allows up to 24). */
const BATCH = 12
const CONCURRENCY = 2

/** What has been asked for already, so a flight is only ever downloaded once per visit. */
const cache = new Map<string, Promise<Point3[] | null>>()

type Response = {tracks?: Record<string, Point3[] | null>}

async function fetchBatch(ids: string[]): Promise<void> {
  let tracks: Record<string, Point3[] | null> = {}
  try {
    const res = await fetch(`/api/flights/tracks?ids=${encodeURIComponent(ids.join(','))}`)
    if (!res.ok) throw new Error('bad response')
    tracks = ((await res.json()) as Response).tracks ?? {}
  } catch {
    // Forget the failed ones so they can be asked for again later.
    for (const id of ids) cache.delete(id)
    throw new Error('Could not load flight tracks.')
  }
  for (const id of ids) pending.get(id)?.(tracks[id] ?? null)
}

const pending = new Map<string, (track: Point3[] | null) => void>()

/**
 * The 3D tracks for these flights (null for one with no log). Already-known flights come from the cache; the
 * rest are fetched in small batches, a couple at a time. Flights that fail to load are simply left out.
 */
export async function loadFlightTracks(ids: string[]): Promise<Map<string, Point3[] | null>> {
  const missing = ids.filter((id) => !cache.has(id))
  for (const id of missing) {
    cache.set(
      id,
      new Promise<Point3[] | null>((resolve) => {
        pending.set(id, (track) => {
          pending.delete(id)
          resolve(track)
        })
      }),
    )
  }

  const batches: string[][] = []
  for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH))
  let next = 0
  const lanes = Array.from({length: Math.min(CONCURRENCY, batches.length)}, async () => {
    while (next < batches.length) {
      const batch = batches[next++]!
      try {
        await fetchBatch(batch)
      } catch {
        for (const id of batch) {
          pending.get(id)?.(null)
          cache.delete(id)
        }
      }
    }
  })
  await Promise.all(lanes)

  const result = new Map<string, Point3[] | null>()
  for (const id of ids) {
    const entry = cache.get(id)
    if (entry) result.set(id, await entry)
  }
  return result
}

/** Forgets everything (for tests). */
export function clearFlightTrackCache() {
  cache.clear()
  pending.clear()
}
