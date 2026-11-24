import {NextResponse} from 'next/server'

import {client} from '@/lib/sanity/client'

type TrackDetail = {
  photos: {
    _id: string
    title?: string
    takenAt?: string
    photo?: {_ref?: string; asset?: {_ref: string}}
  }[]
}

const query = `{
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
    const detail = await client.fetch<TrackDetail>(query, {id}, {next: {revalidate: 60}})
    if (detail.photos.length === 0) {
      const exists = await client.fetch<number>(`count(*[_type == "track" && _id == $id])`, {id})
      if (exists === 0) return NextResponse.json({error: 'Route not found.'}, {status: 404})
    }
    return NextResponse.json(detail)
  } catch {
    return NextResponse.json({error: 'Could not load route.'}, {status: 500})
  }
}