import {describe, expect, it, vi} from 'vitest'

import {
  patchTitleIfEmpty,
  photoTitleFallback,
  placeAutoTitle,
  routeTitleFallback,
  titleFromCoordinates,
} from './auto-title'

describe('placeAutoTitle', () => {
  it('uses locality only', () => {
    expect(placeAutoTitle('Emerson Hill', 'Flight')).toBe('Emerson Hill')
    expect(placeAutoTitle('  ', 'Flight')).toBe('Flight')
    expect(placeAutoTitle(undefined, 'Afternoon Ride')).toBe('Afternoon Ride')
  })
})

describe('patchTitleIfEmpty', () => {
  it('skips title when the editor already set one', () => {
    expect(patchTitleIfEmpty('My route', 'Emerson Hill')).toEqual({})
    expect(patchTitleIfEmpty('  Typed  ', 'Place')).toEqual({})
  })

  it('fills title when empty', () => {
    expect(patchTitleIfEmpty('', 'Emerson Hill')).toEqual({title: 'Emerson Hill'})
    expect(patchTitleIfEmpty(undefined, 'Emerson Hill')).toEqual({title: 'Emerson Hill'})
  })
})

describe('titleFromCoordinates', () => {
  it('returns geocoded place when lookup succeeds', async () => {
    const lookup = vi.fn(async () => 'Mount Mansfield')
    const title = await titleFromCoordinates(44.5, -72.8, lookup, 'ride.gpx')
    expect(title).toBe('Mount Mansfield')
    expect(lookup).toHaveBeenCalledWith(44.5, -72.8)
  })

  it('falls back when geocode fails or returns nothing', async () => {
    const lookup = vi.fn(async () => undefined)
    expect(await titleFromCoordinates(1, 2, lookup, 'my_track')).toBe('my_track')
    const throwing = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await titleFromCoordinates(1, 2, throwing, 'fallback')).toBe('fallback')
  })
})

describe('fallbacks', () => {
  it('prefers GPX track name over file name', () => {
    expect(routeTitleFallback('Afternoon Ride', 'file.gpx')).toBe('Afternoon Ride')
    expect(routeTitleFallback(undefined, 'afternoon_ride.gpx')).toBe('afternoon ride')
  })

  it('derives photo title from file name', () => {
    expect(photoTitleFallback('DJI_0123.JPG')).toBe('DJI 0123')
  })
})