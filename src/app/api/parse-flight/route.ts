import {createClient} from 'next-sanity'
import {NextResponse} from 'next/server'

import {formatDefaultTitle, looksLikeDjiLog, parseFlightLogBytes} from '@/lib/flight-log'
import {reverseGeocodePlace} from '@/lib/reverse-geocode'
import {requireStudioUser} from '@/lib/studio-auth'
import {apiVersion, dataset, projectId} from '@/lib/sanity/env'

export const maxDuration = 120

type Body = {assetId?: string; sourceFilename?: string}

export async function POST(request: Request) {
  const auth = await requireStudioUser(request.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({error: 'Sign in to Studio to parse flight logs.'}, {status: 401})
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({error: 'Invalid JSON.'}, {status: 400})
  }

  const assetId = body.assetId?.trim()
  if (!assetId) return NextResponse.json({error: 'assetId is required.'}, {status: 400})

  const userClient = createClient({
    projectId,
    dataset,
    apiVersion,
    token: auth.token,
    useCdn: false,
  })

  const asset = await userClient.fetch<{url?: string; size?: number} | null>(
    `*[_id == $id][0]{ "url": url, "size": size }`,
    {id: assetId},
  )
  if (!asset?.url) {
    return NextResponse.json({error: 'Log file not found.'}, {status: 404})
  }
  if (asset.size != null && asset.size > 4.5 * 1024 * 1024) {
    return NextResponse.json({error: 'Log file is too large (max ~4 MB).'}, {status: 413})
  }

  const fileRes = await fetch(asset.url, {signal: AbortSignal.timeout(60_000)})
  if (!fileRes.ok) {
    return NextResponse.json({error: 'Could not download the log file.'}, {status: 502})
  }
  const buffer = new Uint8Array(await fileRes.arrayBuffer())
  if (!looksLikeDjiLog(buffer)) {
    return NextResponse.json({error: 'Not a recognized DJI flight log.'}, {status: 422})
  }

  const djiApiKey = process.env.DJI_API_KEY

  try {
    const parsed = await parseFlightLogBytes(buffer, {djiApiKey})

    let place = parsed.place
    if (!place && parsed.hasGps) {
      const coords = JSON.parse(parsed.displayCoordinates) as [number, number][]
      const first = coords[0]
      if (first) {
        place = await reverseGeocodePlace(first[1], first[0])
      }
    }

    const defaultTitle = formatDefaultTitle(parsed.startedAt, place)

    return NextResponse.json({
      ...parsed,
      place,
      defaultTitle,
      title: defaultTitle,
      sourceFilename: body.sourceFilename,
      noMap: !parsed.hasGps,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parse failed.'
    return NextResponse.json({error: message}, {status: 422})
  }
}