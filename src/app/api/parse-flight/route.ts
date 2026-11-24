import {NextResponse} from 'next/server'

import {formatDefaultTitle, looksLikeDjiLog, parseFlightLogBytes} from '@/lib/flight-log'
import {reverseGeocodePlace} from '@/lib/reverse-geocode'
import {requireStudioUser} from '@/lib/studio-auth'

export const maxDuration = 120

const MAX_BYTES = 4.5 * 1024 * 1024

async function readLogBytes(request: Request): Promise<{buffer: Uint8Array; sourceFilename?: string} | {error: Response}> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return {error: NextResponse.json({error: 'Send the log as multipart form field "file".'}, {status: 400})}
  }

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return {error: NextResponse.json({error: 'Expected a file field.'}, {status: 400})}
  }
  if (file.size > MAX_BYTES) {
    return {error: NextResponse.json({error: 'Log file is too large (max ~4 MB).'}, {status: 413})}
  }
  return {buffer: new Uint8Array(await file.arrayBuffer()), sourceFilename: file.name}
}

export async function POST(request: Request) {
  const auth = await requireStudioUser(request.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({error: 'Sign in to Studio to parse flight logs.'}, {status: 401})
  }

  const read = await readLogBytes(request)
  if ('error' in read) return read.error

  const {buffer, sourceFilename} = read
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
      sourceFilename,
      noMap: !parsed.hasGps,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parse failed.'
    return NextResponse.json({error: message}, {status: 422})
  }
}