import {lineCoordinates, type FlightDoc, type MapData, type PinDoc, type TrackDoc} from '@/lib/sanity/types'

export type MapFilterState = {
  query: string
  /**
   * Empty means "everything". Top level: `pin:all`, `track:all` (Routes).
   * Routes sub-filters: `track:bike`, `track:hike`, `flight:all` (Flights), `flight:aircraft:…`.
   */
  types: string[]
  /** Only photos shot with a drone. */
  drone: boolean
}

export const emptyMapFilters: MapFilterState = {query: '', types: [], drone: false}

export type TypeOption = {value: string; label: string}

const TRACK_LABELS: Record<string, string> = {
  bike: 'Bike rides',
  hike: 'Hikes',
  other: 'Other routes',
}

/** Every photo is of the one sort. */
export function pinType() {
  return 'pin:photo'
}

export function trackType(track: TrackDoc) {
  return `track:${track.activity}`
}

/** Routes sub-filter: drone flight paths (not a top-level group). */
export function flightType() {
  return 'flight:all'
}

export function flightAircraftType(aircraft: string) {
  return `flight:aircraft:${aircraft.toLowerCase()}`
}

function dateOf(value?: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** The route kinds that actually exist in the data, so the panel only offers real choices. */
export function filterOptions(data: MapData) {
  const routeKinds = new Map<string, string>()
  for (const track of data.tracks) routeKinds.set(trackType(track), TRACK_LABELS[track.activity] ?? 'Routes')
  const kinds: TypeOption[] = Object.keys(TRACK_LABELS)
    .map((k) => `track:${k}`)
    .filter((value) => routeKinds.has(value))
    .map((value) => ({value, label: routeKinds.get(value)!}))

  const aircraftModels = new Map<string, string>()
  for (const flight of data.flights) {
    const model = flight.aircraft?.trim()
    if (!model) continue
    const key = flightAircraftType(model)
    aircraftModels.set(key, model)
  }
  const aircraftChips: TypeOption[] = [...aircraftModels.entries()]
    .map(([value, label]) => ({value, label}))
    .sort((a, b) => a.label.localeCompare(b.label))

  const groups: TypeOption[] = []
  if (data.pins.length > 0) groups.push({value: 'pin:all', label: 'Photos'})
  if (data.tracks.length > 0 || data.flights.length > 0) {
    groups.push({value: 'track:all', label: 'Routes'})
  }

  const hasDrone = data.pins.some((pin) => pin.isDrone)
  const routesExtras: TypeOption[] =
    data.flights.length > 0 ? [{value: flightType(), label: 'Flights'}] : []
  return {groups, routeKinds: kinds, aircraftChips, hasDrone, routesExtras}
}

export type FilterSubRowParent = 'photos' | 'routes' | 'flights'

export type FilterSubRow = {
  parent: FilterSubRowParent
  depth: number
  label: string
}

function photosParentActive(state: MapFilterState) {
  return state.drone || state.types.includes('pin:all') || state.types.includes(pinType())
}

function routesParentActive(state: MapFilterState) {
  return state.types.includes('track:all')
}

function flightModelsRowActive(state: MapFilterState) {
  return state.types.includes(flightType())
}

const SUB_ROW_PARENT_ORDER: Record<FilterSubRowParent, number> = {
  photos: 0,
  routes: 1,
  flights: 2,
}

/** Sub-filter rows: Photos → Routes subs → drone models when Flights sub is on. */
export function filterSubRows(
  state: MapFilterState,
  options: ReturnType<typeof filterOptions>,
): FilterSubRow[] {
  const rows: FilterSubRow[] = []
  if (options.hasDrone && photosParentActive(state)) {
    rows.push({parent: 'photos', depth: 1, label: 'Photos'})
  }
  if ((options.routeKinds.length > 0 || options.routesExtras.length > 0) && routesParentActive(state)) {
    rows.push({parent: 'routes', depth: 1, label: 'Routes'})
  }
  if (options.aircraftChips.length > 0 && flightModelsRowActive(state)) {
    rows.push({parent: 'flights', depth: 2, label: 'Drone models'})
  }
  return rows.sort(
    (a, b) => a.depth - b.depth || SUB_ROW_PARENT_ORDER[a.parent] - SUB_ROW_PARENT_ORDER[b.parent],
  )
}

function trackSubFilters(state: MapFilterState) {
  return state.types.filter((t) => t.startsWith('track:') && t !== 'track:all')
}

function flightAircraftSubFilters(state: MapFilterState) {
  return state.types.filter((t) => t.startsWith('flight:aircraft:'))
}

function routeSubFilters(state: MapFilterState) {
  return {
    trackKinds: trackSubFilters(state),
    flights: state.types.includes(flightType()),
  }
}

function routesCategoryActive(state: MapFilterState) {
  if (state.types.length === 0) return true
  return (
    state.types.includes('track:all') ||
    trackSubFilters(state).length > 0 ||
    state.types.includes(flightType()) ||
    flightAircraftSubFilters(state).length > 0
  )
}

function routeFilterNarrowed(state: MapFilterState) {
  const {trackKinds, flights} = routeSubFilters(state)
  return trackKinds.length > 0 || flights
}

function photosInScope(state: MapFilterState) {
  if (state.types.length === 0) return true
  return state.types.includes('pin:all') || state.types.includes(pinType())
}

/**
 * Map legacy top-level `flight:all` (old Flights pill) to Routes + Flights sub-filter.
 * Ensure aircraft chips imply the Flights sub-filter too.
 */
export function normalizeMapFilters(state: MapFilterState): MapFilterState {
  if (!filtersActive(state)) return state
  const types = new Set(state.types)
  const hasFlightFilter =
    types.has(flightType()) || [...types].some((t) => t.startsWith('flight:aircraft:'))
  if (hasFlightFilter && !types.has('track:all')) {
    types.add('track:all')
  }
  if ([...types].some((t) => t.startsWith('flight:aircraft:')) && !types.has(flightType())) {
    types.add(flightType())
  }
  return {...state, types: [...types]}
}

/** Flat list for tests and legacy callers. */
export function flatTypeOptions(data: MapData) {
  const {groups, routeKinds, aircraftChips, routesExtras} = filterOptions(data)
  return [...groups, ...routeKinds, ...routesExtras, ...aircraftChips]
}

export function filtersActive(state: MapFilterState) {
  return state.query.trim() !== '' || state.types.length > 0 || state.drone
}

export function activeFilterCount(state: MapFilterState) {
  return (state.query.trim() ? 1 : 0) + state.types.length + (state.drone ? 1 : 0)
}

function matchesQuery(query: string, ...fields: (string | undefined)[]) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return q.split(/\s+/).every((word) => fields.some((field) => field?.toLowerCase().includes(word)))
}

function pinTypeOk(state: MapFilterState) {
  if (!photosInScope(state)) return false
  if (state.types.length === 0) return true
  return state.types.includes(pinType()) || state.types.includes('pin:all')
}

function trackTypeOk(state: MapFilterState, track: TrackDoc) {
  if (state.types.length === 0) return true
  if (!routesCategoryActive(state)) return false
  if (!state.types.includes('track:all') && trackSubFilters(state).length > 0) {
    return trackSubFilters(state).includes(trackType(track))
  }
  if (!state.types.includes('track:all')) return false
  if (!routeFilterNarrowed(state)) return true
  const {trackKinds} = routeSubFilters(state)
  if (trackKinds.length === 0) return false
  return trackKinds.includes(trackType(track))
}

function flightTypeOk(state: MapFilterState, flight: FlightDoc) {
  if (state.types.length === 0) return true
  if (!routesCategoryActive(state)) return false
  if (!state.types.includes('track:all') && !state.types.includes(flightType())) {
    return flightAircraftSubFilters(state).length > 0
      ? Boolean(
          flight.aircraft && flightAircraftSubFilters(state).includes(flightAircraftType(flight.aircraft)),
        )
      : false
  }
  if (!state.types.includes('track:all')) return false
  if (!routeFilterNarrowed(state)) return true
  if (!routeSubFilters(state).flights) return false
  const aircraft = flightAircraftSubFilters(state)
  if (aircraft.length > 0) {
    return Boolean(flight.aircraft && aircraft.includes(flightAircraftType(flight.aircraft)))
  }
  return true
}

export function applyMapFilters(data: MapData, state: MapFilterState): MapData {
  const normalized = normalizeMapFilters(state)
  if (!filtersActive(normalized)) return data
  return {
    ...data,
    pins: data.pins.filter(
      (pin) =>
        pinTypeOk(normalized) &&
        (!normalized.drone || pin.isDrone === true) &&
        matchesQuery(normalized.query, pin.title, pin.note, pin.isDrone ? 'drone' : undefined),
    ),
    tracks: data.tracks.filter(
      (track) =>
        trackTypeOk(normalized, track) &&
        matchesQuery(normalized.query, track.title, TRACK_LABELS[track.activity]),
    ),
    flights: data.flights.filter(
      (flight) =>
        flightTypeOk(normalized, flight) &&
        matchesQuery(normalized.query, flight.title, flight.place, flight.aircraft, 'flight', 'drone'),
    ),
  }
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