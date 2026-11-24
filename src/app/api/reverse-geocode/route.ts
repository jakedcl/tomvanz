import {NextResponse} from 'next/server'

import {reverseGeocodePlace} from '@/lib/reverse-geocode'
import {requireStudioUser} from '@/lib/studio-auth'

export const maxDuration = 30

export async function POST(request: Request) {
  const auth = await requireStudioUser(request.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({error: 'Sign in to Studio to look up places.'}, {status: 401})
  }

  let body: {lat?: number; lng?: number}
  try {
    body = (await request.json()) as {lat?: number; lng?: number}
  } catch {
    return NextResponse.json({error: 'Expected JSON body with lat and lng.'}, {status: 400})
  }

  const {lat, lng} = body
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180) {
    return NextResponse.json({error: 'Invalid coordinates.'}, {status: 400})
  }

  const place = await reverseGeocodePlace(lat!, lng!)
  return NextResponse.json({place})
}