import {
  parseDisplayCoordinates,
  patchFieldsFromSinglePlan,
  planPhotoLinks,
  planRoutePhotoLinks,
  planSinglePhotoLinks,
  type FlightLinkTarget,
  type PhotoLinkCandidate,
  type RouteLinkTarget,
} from './photo-auto-link'

export type PhotoLinkClient = {
  fetch: <T>(query: string, params?: Record<string, unknown>) => Promise<T>
  patch: (id: string) => {
    set: (fields: Record<string, unknown>) => {commit: () => Promise<unknown>}
  }
}

const PHOTO_CANDIDATES_QUERY = `*[_type == "photo" && !defined(flight)]{
  _id,
  takenAt,
  drone,
  cameraMake,
  cameraModel,
  "fileName": image.asset->originalFilename,
  "exifDateTimeOriginal": image.asset->metadata.exif.DateTimeOriginal,
  "lat": location.lat,
  "lng": location.lng,
  "hasFlightRef": defined(flight),
  "hasRouteRef": defined(route)
}`

const ROUTE_PHOTO_CANDIDATES_QUERY = `*[_type == "photo" && !defined(route)]{
  _id,
  takenAt,
  drone,
  cameraMake,
  cameraModel,
  "fileName": image.asset->originalFilename,
  "exifDateTimeOriginal": image.asset->metadata.exif.DateTimeOriginal,
  "lat": location.lat,
  "lng": location.lng,
  "hasFlightRef": defined(flight),
  "hasRouteRef": defined(route)
}`

const FLIGHT_TARGETS_QUERY = `*[_type == "flight" && defined(startedAt) && defined(durationSeconds)]{
  _id,
  startedAt,
  endedAt,
  durationSeconds,
  aircraft,
  displayCoordinates
}`

const ROUTE_TARGETS_QUERY = `*[_type == "track" && defined(route.coordinates)]{
  _id,
  startedAt,
  endedAt,
  "coordinates": route.coordinates
}`

function flightTargetFromDoc(doc: {
  _id: string
  startedAt: string
  endedAt?: string
  durationSeconds: number
  aircraft?: string
  displayCoordinates?: string
}): FlightLinkTarget {
  return {
    _id: doc._id,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    durationSeconds: doc.durationSeconds,
    aircraft: doc.aircraft,
    trackCoords: parseDisplayCoordinates(doc.displayCoordinates),
  }
}

function routeTargetFromDoc(doc: {
  _id: string
  startedAt?: string
  endedAt?: string
  coordinates: string
}): RouteLinkTarget | null {
  let coordinates: ReturnType<typeof parseDisplayCoordinates> = []
  try {
    const raw = JSON.parse(doc.coordinates) as unknown
    if (Array.isArray(raw)) {
      coordinates = raw
        .map((p) =>
          Array.isArray(p) && p.length >= 2 ? ([Number(p[0]), Number(p[1])] as [number, number]) : null,
        )
        .filter((p): p is [number, number] => p != null && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    }
  } catch {
    return null
  }
  if (coordinates.length < 2) return null
  return {_id: doc._id, startedAt: doc.startedAt, endedAt: doc.endedAt, coordinates}
}

export async function linkPhotosToFlightDocument(
  client: PhotoLinkClient,
  flightId: string,
  startedAt: string,
  durationSeconds: number,
  options?: {endedAt?: string; aircraft?: string; displayCoordinates?: string},
): Promise<{unlinkedLabels: string[]}> {
  const flight = flightTargetFromDoc({
    _id: flightId,
    startedAt,
    durationSeconds,
    endedAt: options?.endedAt,
    aircraft: options?.aircraft,
    displayCoordinates: options?.displayCoordinates,
  })
  const candidates = await client.fetch<PhotoLinkCandidate[]>(PHOTO_CANDIDATES_QUERY)
  const {linkIds, unlinkedLabels} = planPhotoLinks(candidates, flight)
  await Promise.all(
    linkIds.map((id) =>
      client.patch(id).set({flight: {_type: 'reference', _ref: flightId}}).commit(),
    ),
  )
  return {unlinkedLabels}
}

export async function linkPhotosToRouteDocument(
  client: PhotoLinkClient,
  routeId: string,
  startedAt: string,
  endedAt: string,
  coordinates: [number, number][],
): Promise<{linkedCount: number}> {
  const route: RouteLinkTarget = {_id: routeId, startedAt, endedAt, coordinates}
  const candidates = await client.fetch<PhotoLinkCandidate[]>(ROUTE_PHOTO_CANDIDATES_QUERY)
  const {linkIds} = planRoutePhotoLinks(candidates, route)
  await Promise.all(
    linkIds.map((id) =>
      client.patch(id).set({route: {_type: 'reference', _ref: routeId}}).commit(),
    ),
  )
  return {linkedCount: linkIds.length}
}

export async function autoLinkPhotoDocument(
  client: PhotoLinkClient,
  photoId: string,
  photo: PhotoLinkCandidate,
): Promise<void> {
  if (photo.hasFlightRef && photo.hasRouteRef) return
  const [flights, routes] = await Promise.all([
    client.fetch<
      {
        _id: string
        startedAt: string
        endedAt?: string
        durationSeconds: number
        aircraft?: string
        displayCoordinates?: string
      }[]
    >(FLIGHT_TARGETS_QUERY),
    client.fetch<{_id: string; startedAt?: string; endedAt?: string; coordinates: string}[]>(
      ROUTE_TARGETS_QUERY,
    ),
  ])
  const flightTargets = flights.map(flightTargetFromDoc)
  const routeTargets = routes
    .map(routeTargetFromDoc)
    .filter((r): r is RouteLinkTarget => r != null)

  const plan = planSinglePhotoLinks(photo, flightTargets, routeTargets)
  const fields = patchFieldsFromSinglePlan(plan)
  if (Object.keys(fields).length === 0) return
  await client.patch(photoId).set(fields).commit()
}

export async function autoLinkPhotoById(client: PhotoLinkClient, photoId: string): Promise<void> {
  const photo = await client.fetch<PhotoLinkCandidate | null>(
    `*[_id == $id][0]{
      _id,
      takenAt,
      drone,
      cameraMake,
      cameraModel,
      "fileName": image.asset->originalFilename,
      "exifDateTimeOriginal": image.asset->metadata.exif.DateTimeOriginal,
      "lat": location.lat,
      "lng": location.lng,
      "hasFlightRef": defined(flight),
      "hasRouteRef": defined(route)
    }`,
    {id: photoId},
  )
  if (!photo) return
  await autoLinkPhotoDocument(client, photoId, photo)
}
