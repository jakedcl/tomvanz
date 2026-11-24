import {planPhotoLinks, type PhotoLinkCandidate} from './flight-photo-link'

/** Minimal Sanity client surface for photo ↔ flight linking. */
export type FlightPhotoLinkClient = {
  fetch: <T>(query: string, params?: Record<string, unknown>) => Promise<T>
  patch: (id: string) => {
    set: (fields: Record<string, unknown>) => {commit: () => Promise<unknown>}
  }
}

const CANDIDATES_QUERY = `*[_type == "photo" && !defined(flight)]{
  _id,
  takenAt,
  "fileName": image.asset->originalFilename
}`

export async function linkPhotosToFlightDocument(
  client: FlightPhotoLinkClient,
  flightId: string,
  startedAt: string,
  durationSeconds: number,
): Promise<{unlinkedLabels: string[]}> {
  const candidates = await client.fetch<PhotoLinkCandidate[]>(CANDIDATES_QUERY)
  const {linkIds, unlinkedLabels} = planPhotoLinks(candidates, startedAt, durationSeconds)
  await Promise.all(
    linkIds.map((id) =>
      client.patch(id).set({flight: {_type: 'reference', _ref: flightId}}).commit(),
    ),
  )
  return {unlinkedLabels}
}