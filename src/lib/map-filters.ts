import {lineCoordinates, type FlightDoc, type MapData, type PinDoc, type TrackDoc} from '@/lib/sanity/types'

/*
 * How the filters think
 * ---------------------
 * Everything on the map lives in one of two worlds: GROUND (ground photos, bike rides, hikes, other routes) or
 * AERIAL (aerial photos, drone flights). A sub-filter pill belongs to one world. Once a pill from one world is
 * on, the other world's pills are switched off and can't be chosen, so a combination like "aerial hikes" can't
 * exist. The world then applies to everything shown: choosing Hikes also limits the photos to ground photos.
 * The pills in the panel are only ever changed through the toggle functions below, which keep this true.
 */

export type World = 'ground' | 'aerial'
export type PhotoKind = 'aerial' | 'ground'
export type RouteKind = 'bike' | 'hike' | 'other' | 'flights'
export type Group = 'photos' | 'routes'

export type MapFilterState = {
  query: string
  /** The Photos pill. */
  photos: boolean
  /** The Routes pill. */
  routes: boolean
  /** Sub-pills of Photos. Empty means every photo (within the world, if one is chosen). */
  photoKinds: PhotoKind[]
  /** Sub-pills of Routes. Empty means every route (within the world, if one is chosen). */
  routeKinds: RouteKind[]
  /** Drone models, only while the Flights sub-pill is on. Lower-cased. Empty means every model. */
  aircraft: string[]
}

export const emptyMapFilters: MapFilterState = {
  query: '',
  photos: false,
  routes: false,
  photoKinds: [],
  routeKinds: [],
  aircraft: [],
}

export type Pill = {kind: PhotoKind | RouteKind; label: string}
export type AircraftPill = {value: string; label: string}

const WORLD_OF: Record<PhotoKind | RouteKind, World> = {
  aerial: 'aerial',
  ground: 'ground',
  bike: 'ground',
  hike: 'ground',
  other: 'ground',
  flights: 'aerial',
}

const KIND_LABELS: Record<PhotoKind | RouteKind, string> = {
  aerial: 'Aerial',
  ground: 'Ground',
  bike: 'Bike rides',
  hike: 'Hikes',
  other: 'Other routes',
  flights: 'Flights',
}

const TRACK_LABELS: Record<string, string> = {
  bike: 'Bike rides',
  hike: 'Hikes',
  other: 'Other routes',
}

const ROUTE_KIND_ORDER: RouteKind[] = ['bike', 'hike', 'other', 'flights']

const aircraftKey = (model: string) => model.trim().toLowerCase()

function dateOf(value?: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** The pills that actually exist in the data, so the panel only offers real choices. */
export function filterOptions(data: MapData) {
  const hasAerialPhotos = data.pins.some((pin) => pin.isDrone)
  const hasGroundPhotos = data.pins.some((pin) => !pin.isDrone)
  // "Aerial" / "Ground" only help when there are both kinds of photo to tell apart.
  const photoKinds: Pill[] =
    hasAerialPhotos && hasGroundPhotos
      ? [
          {kind: 'aerial', label: KIND_LABELS.aerial},
          {kind: 'ground', label: KIND_LABELS.ground},
        ]
      : []

  const present = new Set<RouteKind>()
  for (const track of data.tracks) present.add(track.activity)
  if (data.flights.length > 0) present.add('flights')
  const routeKinds: Pill[] = ROUTE_KIND_ORDER.filter((kind) => present.has(kind)).map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
  }))

  const models = new Map<string, string>()
  for (const flight of data.flights) {
    const model = flight.aircraft?.trim()
    if (model) models.set(aircraftKey(model), model)
  }
  const aircraft: AircraftPill[] = [...models.entries()]
    .map(([value, label]) => ({value, label}))
    .sort((a, b) => a.label.localeCompare(b.label))

  return {
    hasPhotos: data.pins.length > 0,
    hasRoutes: data.tracks.length > 0 || data.flights.length > 0,
    photoKinds,
    routeKinds,
    aircraft,
  }
}

export type FilterOptions = ReturnType<typeof filterOptions>

/** Which world the chosen sub-pills put us in, or null when none is chosen yet. */
export function worldOf(state: MapFilterState): World | null {
  const chosen = [...(state.photos ? state.photoKinds : []), ...(state.routes ? state.routeKinds : [])]
  const first = chosen[0]
  return first ? WORLD_OF[first] : null
}

/** Why a sub-pill can't be chosen right now (the pill in the other world that's on), or null if it can. */
export function pillBlockedBy(state: MapFilterState, kind: PhotoKind | RouteKind): string | null {
  const world = worldOf(state)
  if (world === null || WORLD_OF[kind] === world) return null
  const blocker = [...state.photoKinds, ...state.routeKinds].find((chosen) => WORLD_OF[chosen] === world)
  return blocker ? KIND_LABELS[blocker] : null
}

/**
 * Makes any state valid: sub-pills only while their parent is on, drone models only while Flights is on, and
 * only one world (if two sneak in, ground wins). The panel can't produce a bad state; this is the safety net.
 */
export function normalizeMapFilters(state: MapFilterState): MapFilterState {
  let photoKinds = state.photos ? [...new Set(state.photoKinds)] : []
  let routeKinds = state.routes ? [...new Set(state.routeKinds)] : []
  const worlds = new Set([...photoKinds, ...routeKinds].map((kind) => WORLD_OF[kind]))
  if (worlds.has('ground') && worlds.has('aerial')) {
    photoKinds = photoKinds.filter((kind) => WORLD_OF[kind] === 'ground')
    routeKinds = routeKinds.filter((kind) => WORLD_OF[kind] === 'ground')
  }
  const aircraft = routeKinds.includes('flights') ? [...new Set(state.aircraft)] : []
  return {...state, photoKinds, routeKinds, aircraft}
}

/** The Photos or Routes pill. Turning it off also turns off the pills that hang off it. */
export function toggleGroup(state: MapFilterState, group: Group): MapFilterState {
  return normalizeMapFilters({...state, [group]: !state[group]})
}

/** A sub-pill. Does nothing if it belongs to the other world (it can't be chosen). */
export function toggleKind(state: MapFilterState, kind: PhotoKind | RouteKind): MapFilterState {
  const isPhoto = kind === 'aerial' || kind === 'ground'
  const list = (isPhoto ? state.photoKinds : state.routeKinds) as (PhotoKind | RouteKind)[]
  if (list.includes(kind)) {
    const next = list.filter((item) => item !== kind)
    return normalizeMapFilters({...state, [isPhoto ? 'photoKinds' : 'routeKinds']: next})
  }
  if (pillBlockedBy(state, kind)) return state
  return normalizeMapFilters({
    ...state,
    [isPhoto ? 'photoKinds' : 'routeKinds']: [...list, kind],
  })
}

/** A drone model, shown while Flights is on. */
export function toggleAircraft(state: MapFilterState, model: string): MapFilterState {
  const key = aircraftKey(model)
  const aircraft = state.aircraft.includes(key) ? state.aircraft.filter((item) => item !== key) : [...state.aircraft, key]
  return normalizeMapFilters({...state, aircraft})
}

/** True when a pill is on. Search text is not a filter: it never hides anything on the map. */
export function filtersActive(state: MapFilterState) {
  return activeFilterCount(state) > 0
}

/** How many pills are on (the search text doesn't count). */
export function activeFilterCount(state: MapFilterState) {
  return (
    (state.photos ? 1 : 0) +
    (state.routes ? 1 : 0) +
    state.photoKinds.length +
    state.routeKinds.length +
    state.aircraft.length
  )
}

function matchesQuery(query: string, ...fields: (string | undefined)[]) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return q.split(/\s+/).every((word) => fields.some((field) => field?.toLowerCase().includes(word)))
}

/** With neither pill on, everything shows; with one on, only that sort does. */
const showsPhotos = (state: MapFilterState) => state.photos || !state.routes
const showsRoutes = (state: MapFilterState) => state.routes || !state.photos

function pinOk(state: MapFilterState, world: World | null, pin: PinDoc) {
  if (!showsPhotos(state)) return false
  const kind: PhotoKind = pin.isDrone ? 'aerial' : 'ground'
  if (state.photoKinds.length > 0) return state.photoKinds.includes(kind)
  return world === null || WORLD_OF[kind] === world
}

function trackOk(state: MapFilterState, world: World | null, track: TrackDoc) {
  if (!showsRoutes(state)) return false
  if (state.routeKinds.length > 0) return state.routeKinds.includes(track.activity)
  return world === null || world === 'ground'
}

function flightOk(state: MapFilterState, world: World | null, flight: FlightDoc) {
  if (!showsRoutes(state)) return false
  if (state.routeKinds.length > 0) {
    if (!state.routeKinds.includes('flights')) return false
    if (state.aircraft.length === 0) return true
    return Boolean(flight.aircraft && state.aircraft.includes(aircraftKey(flight.aircraft)))
  }
  return world === null || world === 'aerial'
}

/**
 * What the pills and the search text both allow: the list of search results. (Search lists what the pills currently
 * show, so picking a result always opens something that is on the map.)
 */
export function applyMapFilters(data: MapData, input: MapFilterState): MapData {
  const state = normalizeMapFilters(input)
  if (!filtersActive(state) && !state.query.trim()) return data
  const world = worldOf(state)
  return {
    ...data,
    pins: data.pins.filter(
      (pin) =>
        pinOk(state, world, pin) &&
        matchesQuery(state.query, pin.title, pin.note, pin.isDrone ? 'drone' : undefined),
    ),
    tracks: data.tracks.filter(
      (track) =>
        trackOk(state, world, track) && matchesQuery(state.query, track.title, TRACK_LABELS[track.activity]),
    ),
    flights: data.flights.filter(
      (flight) =>
        flightOk(state, world, flight) &&
        matchesQuery(state.query, flight.title, flight.place, flight.aircraft, 'flight', 'drone'),
    ),
  }
}

/**
 * What is drawn on the map: only the pills decide. The search text is ignored, so typing in search (or picking a
 * result) never hides or shows anything on the map; it just finds things.
 */
export function visibleOnMap(data: MapData, state: MapFilterState): MapData {
  return applyMapFilters(data, {...state, query: ''})
}

/** True when two states have the same pills on (whatever the search text is). */
export function samePills(a: MapFilterState, b: MapFilterState): boolean {
  const pills = (state: MapFilterState) =>
    JSON.stringify([state.photos, state.routes, state.photoKinds, state.routeKinds, state.aircraft])
  return pills(a) === pills(b)
}

export type ResultItem = {
  kind: 'pin' | 'track' | 'flight'
  id: string
  title: string
  label: string
  date: string | undefined
  photo: PinDoc['photo']
  miles: number | null
  activity?: TrackDoc['activity']
}

/** Everything that passed the filters as one list: routes and flights newest first, then undated photos A–Z. */
export function resultList(shown: MapData, miles: (track: TrackDoc) => number | null): ResultItem[] {
  const items: ResultItem[] = [
    ...shown.pins.map<ResultItem>((pin) => ({
      kind: 'pin',
      id: pin._id,
      title: pin.title?.trim() || 'Untitled photo',
      label: pin.isDrone ? 'Aerial' : 'Photo',
      date: pin.at,
      photo: pin.photo,
      miles: null,
    })),
    ...shown.tracks.map<ResultItem>((track) => ({
      kind: 'track',
      id: track._id,
      title: track.title?.trim() || 'Untitled route',
      label: TRACK_LABELS[track.activity] ?? 'Route',
      date: track.startedAt,
      photo: track.photo,
      miles: miles(track),
      activity: track.activity,
    })),
    ...shown.flights.map<ResultItem>((flight) => ({
      kind: 'flight',
      id: flight._id,
      title: flight.title?.trim() || 'Untitled flight',
      label: flight.aircraft?.trim() || 'Flight',
      date: flight.startedAt,
      photo: undefined,
      miles: flight.distanceMeters != null ? flight.distanceMeters / 1609.344 : null,
    })),
  ]
  const time = (item: ResultItem) => dateOf(item.date)
  return items.sort((a, b) => {
    const ta = time(a)
    const tb = time(b)
    if (ta == null && tb == null) return a.title.localeCompare(b.title)
    if (ta == null) return 1
    if (tb == null) return -1
    return tb - ta
  })
}

export function trackCoords(track: TrackDoc) {
  return lineCoordinates(track.route)
}

export function flightCoords(flight: FlightDoc) {
  return lineCoordinates(flight.path)
}