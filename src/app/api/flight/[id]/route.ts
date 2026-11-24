import {NextResponse} from 'next/server'

import {client} from '@/lib/sanity/client'

type FlightDetail = {
  series: string | null
  photos: {
    _id: string
    title?: string
    takenAt?: string
    photo?: {_ref?: string; asset?: {_ref: string}}
  }[]
}

const query = `{
  "series": *[_type == "flight" && _id == $id][0].series,
  "photos": *[_type == "photo" && references($id)] | order(takenAt asc) {
    _id,
    title,
    takenAt,
    "photo": image
  }
}`

export async function GET(_request: Request, context: {params: Promise<{id: string}>}) {
  const {id} = await context.params
  if (!id) return NextResponse.json({error: 'Missing id.'}, {status: 400})

  try {
    const detail = await client.fetch<FlightDetail>(query, {id}, {next: {revalidate: 60}})
    if (detail.series == null && detail.photos.length === 0) {
      return NextResponse.json({error: 'Flight not found.'}, {status: 404})
    }
    return NextResponse.json(detail)
  } catch {
    return NextResponse.json({error: 'Could not load flight.'}, {status: 500})
  }
}