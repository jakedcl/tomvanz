import {describe, expect, it} from 'vitest'

import {
  applyMapFilters,
  emptyMapFilters,
  filterOptions,
  filterSubRows,
  filtersActive,
  flatTypeOptions,
  flightAircraftType,
  flightType,
  normalizeMapFilters,
  resultList,
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

describe('applyMapFilters', () => {
  it('returns everything when no filter is set', () => {
    expect(filtersActive(emptyMapFilters)).toBe(false)
    expect(applyMapFilters(data, emptyMapFilters)).toBe(data)
  })

  it('matches the search text against titles and notes, every word required', () => {
    const byNote = applyMapFilters(data, {...emptyMapFilters, query: 'highest ny'})
    expect(byNote.pins.map((p) => p._id)).toEqual(['a'])
    expect(byNote.tracks).toEqual([])
  })

  it('filters by route kind without Routes parent still narrows GPX routes', () => {
    const hikes = applyMapFilters(data, {...emptyMapFilters, types: ['track:hike']})
    expect(hikes.pins).toEqual([])
    expect(hikes.tracks.map((t) => t._id)).toEqual(['t'])

    const bikes = applyMapFilters(data, {...emptyMapFilters, types: ['track:bike']})
    expect(bikes.tracks).toEqual([])
  })

  it('also searches the word drone for drone photos', () => {
    const drone = applyMapFilters(data, {...emptyMapFilters, query: 'drone'})
    expect(drone.pins.map((p) => p._id)).toEqual(['b'])
  })
})

describe('Photos / Routes group chips', () => {
  it('Photos keeps every kind of photo and drops routes', () => {
    const photos = applyMapFilters(data, {...emptyMapFilters, types: ['pin:all']})
    expect(photos.pins).toHaveLength(3)
    expect(photos.tracks).toEqual([])
  })

  it('Routes alone keeps GPX routes and drone flights', () => {
    const routes = applyMapFilters(rich, {...emptyMapFilters, types: ['track:all']})
    expect(routes.pins).toEqual([])
    expect(routes.tracks).toHaveLength(2)
    expect(routes.flights).toHaveLength(2)
  })

  it('Photos and a specific kind of route combine', () => {
    const mixed = applyMapFilters(data, {...emptyMapFilters, types: ['pin:all', 'track:hike']})
    expect(mixed.pins).toHaveLength(3)
    expect(mixed.tracks).toHaveLength(1)
  })
})

describe('drone filter', () => {
  it('keeps only drone photos and still shows all routes when nothing else is filtered', () => {
    const drone = applyMapFilters(data, {...emptyMapFilters, drone: true})
    expect(drone.pins.map((p) => p._id)).toEqual(['b'])
    expect(drone.tracks).toHaveLength(1)
    expect(filtersActive({...emptyMapFilters, drone: true})).toBe(true)
  })

  it('aerial with routes and flights does not hide tracks or flights', () => {
    const filtered = applyMapFilters(rich, {
      ...emptyMapFilters,
      drone: true,
      types: ['pin:all', 'track:all', 'track:hike', flightType()],
    })
    expect(filtered.pins.map((p) => p._id)).toEqual(['b'])
    expect(filtered.tracks.map((t) => t._id)).toEqual(['hike1'])
    expect(filtered.flights).toHaveLength(2)
  })

  it('combines with the other filters', () => {
    const some = applyMapFilters(data, {...emptyMapFilters, drone: true, query: 'drone'})
    expect(some.pins.map((p) => p._id)).toEqual(['b'])
    const none = applyMapFilters(data, {...emptyMapFilters, drone: true, query: 'nothing matches this'})
    expect(none.pins).toEqual([])
  })

  it('only offers the filter when some photo is a drone photo', () => {
    expect(filterOptions(data).hasDrone).toBe(true)
    expect(filterOptions({...data, pins: data.pins.map((p) => ({...p, isDrone: false}))}).hasDrone).toBe(false)
  })
})

describe('sub-filter narrowing', () => {
  it('Routes parent plus Hikes sub shows only hikes, not bikes', () => {
    const filtered = applyMapFilters(rich, {
      ...emptyMapFilters,
      types: ['track:all', 'track:hike'],
    })
    expect(filtered.tracks.map((t) => t._id)).toEqual(['hike1'])
    expect(filtered.flights).toEqual([])
  })

  it('Routes Flights sub shows flights only', () => {
    const filtered = applyMapFilters(rich, {
      ...emptyMapFilters,
      types: ['track:all', flightType()],
    })
    expect(filtered.tracks).toEqual([])
    expect(filtered.flights).toHaveLength(2)
  })

  it('Routes Hikes and Flights subs union', () => {
    const filtered = applyMapFilters(rich, {
      ...emptyMapFilters,
      types: ['track:all', 'track:hike', flightType()],
    })
    expect(filtered.tracks.map((t) => t._id)).toEqual(['hike1'])
    expect(filtered.flights).toHaveLength(2)
  })

  it('Flights sub plus aircraft narrows drone models only', () => {
    const air2 = flightAircraftType('DJI Air 2S')
    const filtered = applyMapFilters(rich, {
      ...emptyMapFilters,
      types: ['track:all', flightType(), air2],
    })
    expect(filtered.tracks).toEqual([])
    expect(filtered.flights.map((f) => f._id)).toEqual(['f-air2'])
  })
})

describe('normalizeMapFilters', () => {
  it('maps legacy top-level flight:all to Routes plus Flights sub', () => {
    const normalized = normalizeMapFilters({...emptyMapFilters, types: [flightType()]})
    expect(normalized.types).toContain('track:all')
    expect(normalized.types).toContain(flightType())

    const filtered = applyMapFilters(rich, {...emptyMapFilters, types: [flightType()]})
    expect(filtered.tracks).toEqual([])
    expect(filtered.flights).toHaveLength(2)
  })
})

describe('filterOptions', () => {
  it('main row is Photos and Routes only', () => {
    expect(filterOptions(rich).groups.map((o) => o.value)).toEqual(['pin:all', 'track:all'])
    expect(filterOptions(rich).groups.some((o) => o.value === flightType())).toBe(false)
  })

  it('flat list includes route subs and aircraft', () => {
    expect(flatTypeOptions(rich).map((o) => o.value)).toEqual([
      'pin:all',
      'track:all',
      'track:bike',
      'track:hike',
      flightType(),
      flightAircraftType('DJI Air 2S'),
      flightAircraftType('DJI Mini 3'),
    ])
  })
})

describe('filterSubRows', () => {
  it('shows photo and route sub-rows when those parents are active', () => {
    const opts = filterOptions(data)
    const rows = filterSubRows({...emptyMapFilters, types: ['pin:all', 'track:all'], drone: true}, opts)
    expect(rows.map((r) => r.parent)).toEqual(['photos', 'routes'])
  })

  it('shows drone models row only when Flights sub is on', () => {
    const opts = filterOptions(rich)
    const rows = filterSubRows({...emptyMapFilters, types: ['track:all', flightType()]}, opts)
    expect(rows.map((r) => r.parent)).toEqual(['routes', 'flights'])
  })

  it('orders rows Photos, Routes, drone models', () => {
    const opts = filterOptions(rich)
    const rows = filterSubRows(
      {
        ...emptyMapFilters,
        types: ['pin:all', 'track:all', flightType()],
        drone: true,
      },
      opts,
    )
    expect(rows.map((r) => r.parent)).toEqual(['photos', 'routes', 'flights'])
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