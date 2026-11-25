import {lineCoordinates, type FlightDoc, type MapData, type PinDoc, type TrackDoc} from '@/lib/sanity/types'

export type MapFilterState = {
  query: string
  /** Empty means "everything". Values: `pin:all`, `track:all`, `flight:all`, `track:hike`, `flight:aircraft:…`, … */
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
  if (data.tracks.length > 0) groups.push({value: 'track:all', label: 'Routes'})
  if (data.flights.length > 0) groups.push({value: 'flight:all', label: 'Flights'})

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
  return state.types.includes('track:all') || state.types.some((t) => t.startsWith('track:'))
}

function flightsParentActive(state: MapFilterState) {
  return state.types.includes(flightType()) || state.types.some((t) => t.startsWith('flight:aircraft:'))
}

/** Sub-filter rows to show under the main chip row, ordered by depth then parent order. */
export function filterSubRows(
  state: MapFilterState,
  options: ReturnType<typeof filterOptions>,
): FilterSubRow[] {
  const rows: FilterSubRow[] = []
  if (options.hasDrone && photosParentActive(state)) {
    rows.push({parent: 'photos', depth: 1, label: 'Photos'})
  }
  if (options.routeKinds.length > 0 && routesParentActive(state)) {
    rows.push({parent: 'routes', depth: 1, label: 'Routes'})
  }
  if (options.aircraftChips.length > 0 && flightsParentActive(state)) {
    rows.push({parent: 'flights', depth: 1, label: 'Flights'})
  }
  return rows.sort((a, b) => a.depth - b.depth || a.parent.localeCompare(b.parent))
}

/** Flat list for tests and legacy callers. */
export function flatTypeOptions(data: MapData) {
  const {groups, routeKinds, aircraftChips} = filterOptions(data)
  return [...groups, ...routeKinds, ...aircraftChips]
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
  if (state.types.length === 0) return true
  return state.types.includes(pinType()) || state.types.includes('pin:all')
}

function trackTypeOk(state: MapFilterState, track: TrackDoc) {
  if (state.types.length === 0) return true
  const type = trackType(track)
  return state.types.includes(type) || state.types.includes('track:all')
}

function flightTypeOk(state: MapFilterState, flight: FlightDoc) {
  if (state.types.length === 0) return true
  if (state.types.includes(flightType())) return true
  if (flight.aircraft && state.types.includes(flightAircraftType(flight.aircraft))) return true
  return false
}

export function applyMapFilters(data: MapData, state: MapFilterState): MapData {
  if (!filtersActive(state)) return data
  return {
    ...data,
    pins: data.pins.filter(
      (pin) =>
        pinTypeOk(state) &&
        (!state.drone || pin.isDrone === true) &&
        matchesQuery(state.query, pin.title, pin.note, pin.isDrone ? 'drone' : undefined),
    ),
    tracks: data.tracks.filter(
      (track) =>
        !state.drone &&
        trackTypeOk(state, track) &&
        matchesQuery(state.query, track.title, TRACK_LABELS[track.activity]),
    ),
    flights: data.flights.filter(
      (flight) =>
        !state.drone &&
        flightTypeOk(state, flight) &&
        matchesQuery(state.query, flight.title, flight.place, flight.aircraft, 'flight', 'drone'),
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