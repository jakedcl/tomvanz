import {describe, expect, it} from 'vitest'

import {pickLocalityLabel} from './reverse-geocode'

describe('pickLocalityLabel', () => {
  it('prefers suburb over peak landmark name', () => {
    const label = pickLocalityLabel({
      name: 'Blue Mountain',
      addresstype: 'peak',
      address: {suburb: 'Palenville', state: 'New York'},
    })
    expect(label).toBe('Palenville, New York')
  })

  it('prefers town over hamlet (e.g. Saugerties vs Blue Mountain)', () => {
    const label = pickLocalityLabel({
      name: 'Blue Mountain',
      addresstype: 'peak',
      address: {hamlet: 'Blue Mountain', town: 'Saugerties', state: 'New York'},
    })
    expect(label).toBe('Saugerties, New York')
  })

  it('uses neighbourhood when present', () => {
    const label = pickLocalityLabel({
      name: 'Something else',
      address: {neighbourhood: 'Emerson Hill', city: 'New York', state: 'New York'},
    })
    expect(label).toBe('Emerson Hill, New York')
  })
})