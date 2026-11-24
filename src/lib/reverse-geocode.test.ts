import {describe, expect, it} from 'vitest'

import {isSkippableLocality, pickLocalityLabel, placeTitleFromAddress} from './reverse-geocode'

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

  it('uses town name without state (Saugerties)', () => {
    const label = pickLocalityLabel({
      address: {town: 'Saugerties', county: 'Ulster County', state: 'New York'},
    })
    expect(label).toBe('Saugerties')
  })

  it('skips suburb when it is a county name', () => {
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

describe('isSkippableLocality', () => {
  it('flags county and Richmond County suburb', () => {
    expect(isSkippableLocality('Ulster County')).toBe(true)
    expect(isSkippableLocality('Richmond County', 'suburb')).toBe(true)
    expect(isSkippableLocality('Todt Hill', 'hamlet')).toBe(false)
  })
})

describe('placeTitleFromAddress', () => {
  it('walks keys in priority order', () => {
    expect(placeTitleFromAddress({hamlet: 'Todt Hill', suburb: 'Richmond County'})).toBe('Todt Hill')
  })
})