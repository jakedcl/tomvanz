import {describe, expect, it} from 'vitest'

import {formatMapDate} from './format-map-date'

describe('formatMapDate', () => {
  it('keeps the Eastern calendar day for evening local times', () => {
    // 7:45 PM Eastern Nov 11, 2024 is still Nov 12 UTC.
    expect(formatMapDate('2024-11-12T00:45:00.000Z')).toBe('Nov 11, 2024')
  })

  it('formats midday UTC on the same Eastern date when still the same day', () => {
    expect(formatMapDate('2024-10-04T16:00:00.000Z')).toBe('Oct 4, 2024')
  })
})