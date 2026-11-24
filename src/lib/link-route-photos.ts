import {planRoutePhotoLinks, type RoutePhotoLinkCandidate} from './route-photo-link'
import type {LngLat} from './simplify-route'

/** Minimal Sanity client surface for photo ↔ route linking. */
export type RoutePhotoLinkClient = {
  fetch: <T>(query: string, params?: Record<string, unknown>) => Promise<T>
  patch: (id: string) => {
    set: (fields: Record<string, unknown>) => {commit: () => Promise<unknown>}
  }
}

const CANDIDATES_QUERY = `*[_type == "photo" && !defined(route)]{
  _id,
  takenAt,
  "fileName": image.asset->originalFilename,
  "lat": location.lat,
  "lng": location.lng
}`

export async function linkPhotosToRouteDocument(
  client: RoutePhotoLinkClient,
  routeId: string,
  startedAt: string,
  endedAt: string,
  coordinates: LngLat[],
): Promise<{linkedCount: number}> {
  const candidates = await client.fetch<RoutePhotoLinkCandidate[]>(CANDIDATES_QUERY)
  const {linkIds} = planRoutePhotoLinks(candidates, startedAt, endedAt, coordinates)
  await Promise.all(
    linkIds.map((id) =>
      client.patch(id).set({route: {_type: 'reference', _ref: routeId}}).commit(),
    ),
  )
  return {linkedCount: linkIds.length}
}