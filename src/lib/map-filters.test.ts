import {describe, expect, it} from 'vitest'

import {
  activeFilterCount,
  applyMapFilters,
  emptyMapFilters,
  filterOptions,
  filtersActive,
  normalizeMapFilters,
  pillBlockedBy,
  resultList,
  toggleAircraft,
  toggleGroup,
  toggleKind,
  worldOf,
  type MapFilterState,
  type PhotoKind,
  type RouteKind,
} from './map-filters'
import type {MapData} from './sanity/types'

const data: MapData = {
  name: 'test',
  flights: [],
  pins: [
    {_id: 'a', title: 'Mount Marcy', note: 'Highest in NY', at: '2025-07-04T10:00:00Z', location: {lat: 44.1, lng: -73.9}},
    {_id: 'b', title: 'Lake Colden', at: '2024-07-03T10:00:00Z', isDrone: true, location: {lat: 44.1, lng: -73.98}},
    {_id: 'c', title: 'Undated spot', location: {lat: 44.2, lng: -73.8}},
  ],
  tracks: [
    {
      _id: 't',
      title: 'Algonquin loop',
      activity: 'hike',
      startedAt: '2025-07-03T08:00:00Z',
      route: {type: 'LineString', coordinates: '[[0,0],[1,1]]'},
    },
  ],
}

const rich: MapData = {
  name: 'rich',
  pins: data.pins,
  tracks: [
    {
      _id: 'hike1',
      title: 'Hike one',
      activity: 'hike',
      route: {type: 'LineString', coordinates: '[[0,0],[1,1]]'},
    },
    {
      _id: 'bike1',
      title: 'Bike one',
      activity: 'bike',
      route: {type: 'LineString', coordinates: '[[2,2],[3,3]]'},
    },
  ],
  flights: [
    {
      _id: 'f-mini',
      title: 'Mini flight',
      aircraft: 'DJI Mini 3',
      path: {type: 'LineString', coordinates: '[[4,4],[5,5]]'},
    },
    {
      _id: 'f-air2',
      title: 'Air 2S flight',
      aircraft: 'DJI Air 2S',
      path: {type: 'LineString', coordinates: '[[6,6],[7,7]]'},
    },
  ],
}

const ids = (items: {_id: string}[]) => items.map((item) => item._id).sort()

/** Presses a series of pills in order, the way the panel would. */
function pressAll(steps: (string | [string, string])[], start: MapFilterState = emptyMapFilters) {
  let state = start
  for (const step of steps) {
    if (step === 'photos' || step === 'routes') state = toggleGroup(state, step)
    else if (Array.isArray(step)) state = toggleAircraft(state, step[1])
    else state = toggleKind(state, step as PhotoKind | RouteKind)
  }
  return state
}

describe('search and no filter', () => {
  it('returns everything when no filter is set', () => {
    expect(filtersActive(emptyMapFilters)).toBe(false)
    expect(applyMapFilters(data, emptyMapFilters)).toBe(data)
  })

  it('matches the search text against titles and notes, every word required', () => {
    const byNote = applyMapFilters(data, {...emptyMapFilters, query: 'highest ny'})
    expect(byNote.pins.map((p) => p._id)).toEqual(['a'])
    expect(byNote.tracks).toEqual([])
  })

  it('also searches the word drone for drone photos', () => {
    const drone = applyMapFilters(data, {...emptyMapFilters, query: 'drone'})
    expect(drone.pins.map((p) => p._id)).toEqual(['b'])
  })
})

describe('Photos and Routes pills', () => {
  it('Photos alone shows every kind of photo and no routes', () => {
    const out = applyMapFilters(rich, pressAll(['photos']))
    expect(ids(out.pins)).toEqual(['a', 'b', 'c'])
    expect(out.tracks).toEqual([])
    expect(out.flights).toEqual([])
  })

  it('Routes alone shows GPX routes and flights, no photos', () => {
    const out = applyMapFilters(rich, pressAll(['routes']))
    expect(out.pins).toEqual([])
    expect(ids(out.tracks)).toEqual(['bike1', 'hike1'])
    expect(ids(out.flights)).toEqual(['f-air2', 'f-mini'])
  })

  it('both on shows everything', () => {
    const out = applyMapFilters(rich, pressAll(['photos', 'routes']))
    expect(ids(out.pins)).toEqual(['a', 'b', 'c'])
    expect(ids(out.tracks)).toEqual(['bike1', 'hike1'])
    expect(ids(out.flights)).toEqual(['f-air2', 'f-mini'])
  })
})

describe('the two worlds (ground and aerial)', () => {
  it('Hikes with Photos and Routes on shows hikes and only ground photos', () => {
    const state = pressAll(['photos', 'routes', 'hike'])
    expect(worldOf(state)).toBe('ground')
    const out = applyMapFilters(rich, state)
    expect(ids(out.pins)).toEqual(['a', 'c']) // not the aerial photo
    expect(ids(out.tracks)).toEqual(['hike1'])
    expect(out.flights).toEqual([])
  })

  it('Aerial photos switch off the ground route pills, and show flights but no GPX routes', () => {
    const state = pressAll(['photos', 'routes', 'aerial'])
    expect(worldOf(state)).toBe('aerial')
    for (const kind of ['bike', 'hike', 'other'] as const) expect(pillBlockedBy(state, kind)).toBe('Aerial')
    expect(pillBlockedBy(state, 'flights')).toBeNull()
    const out = applyMapFilters(rich, state)
    expect(ids(out.pins)).toEqual(['b'])
    expect(out.tracks).toEqual([])
    expect(ids(out.flights)).toEqual(['f-air2', 'f-mini'])
  })

  it('Flights switches off Ground photos, and limits photos to aerial ones', () => {
    const state = pressAll(['photos', 'routes', 'flights'])
    expect(pillBlockedBy(state, 'ground')).toBe('Flights')
    const out = applyMapFilters(rich, state)
    expect(ids(out.pins)).toEqual(['b'])
    expect(out.tracks).toEqual([])
    expect(ids(out.flights)).toEqual(['f-air2', 'f-mini'])
  })

  it('Ground photos switch off Aerial and Flights, and show ground routes', () => {
    const state = pressAll(['photos', 'routes', 'ground'])
    expect(pillBlockedBy(state, 'aerial')).toBe('Ground')
    expect(pillBlockedBy(state, 'flights')).toBe('Ground')
    const out = applyMapFilters(rich, state)
    expect(ids(out.pins)).toEqual(['a', 'c'])
    expect(ids(out.tracks)).toEqual(['bike1', 'hike1'])
    expect(out.flights).toEqual([])
  })

  it('a pill from the other world can’t be pressed: nothing changes', () => {
    const state = pressAll(['photos', 'routes', 'hike'])
    expect(toggleKind(state, 'aerial')).toBe(state)
    expect(toggleKind(state, 'flights')).toBe(state)
  })

  it('turning the chosen pill off frees the other world again', () => {
    const state = pressAll(['photos', 'routes', 'hike', 'hike'])
    expect(worldOf(state)).toBeNull()
    expect(pillBlockedBy(state, 'aerial')).toBeNull()
    expect(toggleKind(state, 'aerial').photoKinds).toEqual(['aerial'])
  })

  it('same-world pills can be combined', () => {
    const out = applyMapFilters(rich, pressAll(['routes', 'bike', 'hike']))
    expect(ids(out.tracks)).toEqual(['bike1', 'hike1'])
    expect(out.flights).toEqual([])
  })

  it('Aerial and Ground can’t both be on, and neither can their routes', () => {
    const state = pressAll(['photos', 'aerial', 'ground'])
    expect(state.photoKinds).toEqual(['aerial'])
  })
})

describe('Routes sub-pills and drone models', () => {
  it('Hikes alone shows only hikes', () => {
    const out = applyMapFilters(rich, pressAll(['routes', 'hike']))
    expect(ids(out.tracks)).toEqual(['hike1'])
    expect(out.flights).toEqual([])
  })

  it('Flights alone shows only flights; a drone model narrows them', () => {
    const flights = applyMapFilters(rich, pressAll(['routes', 'flights']))
    expect(flights.tracks).toEqual([])
    expect(ids(flights.flights)).toEqual(['f-air2', 'f-mini'])
    const mini = applyMapFilters(rich, pressAll(['routes', 'flights', ['aircraft', 'DJI Mini 3']]))
    expect(ids(mini.flights)).toEqual(['f-mini'])
  })

  it('drone models only exist while Flights is on', () => {
    const withModel = pressAll(['routes', 'flights', ['aircraft', 'DJI Mini 3']])
    expect(withModel.aircraft).toEqual(['dji mini 3'])
    expect(toggleKind(withModel, 'flights').aircraft).toEqual([])
    expect(toggleGroup(withModel, 'routes').aircraft).toEqual([])
  })

  it('turning Photos or Routes off clears the pills that hang off it', () => {
    const state = pressAll(['photos', 'routes', 'aerial', 'flights'])
    const noPhotos = toggleGroup(state, 'photos')
    expect(noPhotos.photoKinds).toEqual([])
    expect(noPhotos.routeKinds).toEqual(['flights'])
    const noRoutes = toggleGroup(state, 'routes')
    expect(noRoutes.routeKinds).toEqual([])
    expect(noRoutes.photoKinds).toEqual(['aerial'])
  })
})

describe('it is impossible to reach a state that makes no sense', () => {
  const actions: ((state: MapFilterState) => MapFilterState)[] = [
    (s) => toggleGroup(s, 'photos'),
    (s) => toggleGroup(s, 'routes'),
    ...(['aerial', 'ground', 'bike', 'hike', 'other', 'flights'] as const).map(
      (kind) => (s: MapFilterState) => toggleKind(s, kind),
    ),
    (s) => toggleAircraft(s, 'DJI Mini 3'),
  ]

  it('after every possible series of up to 5 presses, the rules still hold', () => {
    let checked = 0
    const walk = (state: MapFilterState, depth: number) => {
      const worlds = new Set([...state.photoKinds, ...state.routeKinds].map((kind) => (['aerial', 'flights'].includes(kind) ? 'aerial' : 'ground')))
      expect(worlds.size).toBeLessThanOrEqual(1)
      if (!state.photos) expect(state.photoKinds).toEqual([])
      if (!state.routes) expect(state.routeKinds).toEqual([])
      if (!state.routeKinds.includes('flights')) expect(state.aircraft).toEqual([])
      expect(normalizeMapFilters(state)).toEqual(state)
      checked += 1
      if (depth === 0) return
      for (const action of actions) walk(action(state), depth - 1)
    }
    walk(emptyMapFilters, 5)
    expect(checked).toBeGreaterThan(10000)
  })

  it('normalizing repairs a state that somehow has both worlds, keeping ground', () => {
    const bad: MapFilterState = {...emptyMapFilters, photos: true, routes: true, photoKinds: ['aerial'], routeKinds: ['hike']}
    expect(normalizeMapFilters(bad).photoKinds).toEqual([])
    expect(normalizeMapFilters(bad).routeKinds).toEqual(['hike'])
  })
})

describe('filterOptions', () => {
  it('offers Aerial and Ground only when there are both kinds of photo', () => {
    expect(filterOptions(rich).photoKinds.map((pill) => pill.label)).toEqual(['Aerial', 'Ground'])
    const onlyGround = {...rich, pins: rich.pins.filter((pin) => !pin.isDrone)}
    expect(filterOptions(onlyGround).photoKinds).toEqual([])
    const onlyAerial = {...rich, pins: rich.pins.filter((pin) => pin.isDrone)}
    expect(filterOptions(onlyAerial).photoKinds).toEqual([])
  })

  it('offers only the route kinds that exist, plus Flights and the drone models', () => {
    const options = filterOptions(rich)
    expect(options.routeKinds.map((pill) => pill.label)).toEqual(['Bike rides', 'Hikes', 'Flights'])
    expect(options.aircraft.map((model) => model.label)).toEqual(['DJI Air 2S', 'DJI Mini 3'])
    expect(options.hasPhotos).toBe(true)
    expect(options.hasRoutes).toBe(true)
  })

  it('counts every chosen pill', () => {
    expect(activeFilterCount(emptyMapFilters)).toBe(0)
    expect(activeFilterCount(pressAll(['photos', 'routes', 'hike']))).toBe(3)
  })
})

describe('resultList icons', () => {
  it('carries the activity for routes, and labels photos Photo or Drone', () => {
    const items = resultList(data, () => null)
    expect(items.find((i) => i.kind === 'track')?.activity).toBe('hike')
    expect(items.find((i) => i.id === 'a')).toMatchObject({kind: 'pin', label: 'Photo'})
    expect(items.find((i) => i.id === 'b')).toMatchObject({kind: 'pin', label: 'Aerial'})
  })
})

describe('resultList', () => {
  it('lists dated items newest first, with undated ones last', () => {
    const titles = resultList(data, () => null).map((r) => r.title)
    expect(titles).toEqual(['Mount Marcy', 'Algonquin loop', 'Lake Colden', 'Undated spot'])
  })
})