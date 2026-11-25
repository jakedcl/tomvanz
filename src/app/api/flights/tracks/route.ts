import {NextResponse} from 'next/server'

import {client} from '@/lib/sanity/client'
import {compactFlightTrack} from '@/lib/flyover/compact-track'
import type {Point3} from '@/lib/flyover/track3d'

/** Most flights asked for in one request. */
const MAX_IDS = 24
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/

const query = `*[_type == "flight" && _id in $ids]{_id, series}`

/**
 * Thinned 3D tracks (longitude, latitude, height above takeoff) for the flights the map is about to draw as
 * tubes. The full logs are far too big to send for every flight, so they are thinned here and cached.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? ''
  const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return NextResponse.json({tracks: {}})
  if (ids.length > MAX_IDS || ids.some((id) => !ID_PATTERN.test(id))) {
    return NextResponse.json({error: 'Bad flight ids.'}, {status: 400})
  }

  try {
    const rows = await client.fetch<{_id: string; series: string | null}[]>(query, {ids}, {next: {revalidate: 300}})
    const tracks: Record<string, Point3[] | null> = {}
    for (const id of ids) tracks[id] = null
    for (const row of rows) tracks[row._id] = compactFlightTrack(row.series)
    return NextResponse.json(
      {tracks},
      {headers: {'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400'}},
    )
  } catch {
    return NextResponse.json({error: 'Could not load flights.'}, {status: 500})
  }
}
