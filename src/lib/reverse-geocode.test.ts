import {describe, expect, it} from 'vitest'

import {
  isCountyName,
  isSkippableLocality,
  pickLocalityLabel,
  placeTitleFromAddress,
  stripMunicipalPrefix,
} from './reverse-geocode'

describe('pickLocalityLabel', () => {
  it('uses neighbourhood without state (Emerson Hill)', () => {
    const label = pickLocalityLabel({
      name: 'Something else',
      address: {neighbourhood: 'Emerson Hill', city: 'New York', state: 'New York'},
    })
    expect(label).toBe('Emerson Hill')
  })

  it('May 18 Staten Island: prefers hamlet over Richmond County suburb', () => {
    const label = pickLocalityLabel({
      addresstype: 'hamlet',
      address: {
        hamlet: 'Todt Hill',
        suburb: 'Richmond County',
        city: 'New York',
        state: 'New York',
      },
    })
    expect(label).toBe('Todt Hill')
  })

  it('Staten Island when suburb is the borough and city is New York', () => {
    const label = pickLocalityLabel({
      address: {suburb: 'Staten Island', city: 'New York', state: 'New York'},
    })
    expect(label).toBe('Staten Island')
  })

  it('Saugerties: town beats peak hamlet', () => {
    const label = pickLocalityLabel({
      name: 'Blue Mountain',
      addresstype: 'peak',
      address: {hamlet: 'Blue Mountain', town: 'Town of Saugerties', state: 'New York'},
    })
    expect(label).toBe('Saugerties')
  })

  it('skips Richmond County suburb and falls back to borough city', () => {
    const label = pickLocalityLabel({
      address: {suburb: 'Richmond County', city: 'Staten Island', state: 'New York'},
    })
    expect(label).toBe('Staten Island')
  })

  it('uses suburb when it is a real neighborhood name', () => {
    const label = pickLocalityLabel({
      name: 'Blue Mountain',
      addresstype: 'peak',
      address: {suburb: 'Palenville', state: 'New York'},
    })
    expect(label).toBe('Palenville')
  })
})

describe('isCountyName', () => {
  it('flags county names', () => {
    expect(isCountyName('Ulster County')).toBe(true)
    expect(isCountyName('Richmond County')).toBe(true)
    expect(isSkippableLocality('Richmond County')).toBe(true)
    expect(isCountyName('Todt Hill')).toBe(false)
  })
})

describe('stripMunicipalPrefix', () => {
  it('strips town/village prefixes', () => {
    expect(stripMunicipalPrefix('Town of Saugerties')).toBe('Saugerties')
  })
})

describe('placeTitleFromAddress', () => {
  it('walks keys in priority order', () => {
    expect(placeTitleFromAddress({town: 'Town of Saugerties', hamlet: 'Blue Mountain'})).toBe('Saugerties')
    expect(placeTitleFromAddress({hamlet: 'Todt Hill', suburb: 'Richmond County'})).toBe('Todt Hill')
  })
})