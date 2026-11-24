import {describe, expect, it} from 'vitest'

import {pinViewPadding, shouldFlyToSelection, trackFitPadding} from './map-focus'

describe('trackFitPadding', () => {
  it('reserves at least the panel height plus margin at the bottom', () => {
    const padding = trackFitPadding(844, 280)
    expect(padding.bottom).toBeGreaterThanOrEqual(300)
    expect(padding.top).toBeGreaterThan(0)
  })

  it('uses a sensible minimum when no panel is open', () => {
    expect(trackFitPadding(600, 0).bottom).toBe(56)
  })
})

describe('pinViewPadding', () => {
  it('lifts the pin above the panel', () => {
    expect(pinViewPadding(320).bottom).toBeGreaterThanOrEqual(344)
  })
})

describe('shouldFlyToSelection', () => {
  it('only flies to tracks and flights when fly is set', () => {
    expect(shouldFlyToSelection({kind: 'track', id: 'a', fly: false})).toBe(false)
    expect(shouldFlyToSelection({kind: 'track', id: 'a'})).toBe(false)
    expect(shouldFlyToSelection({kind: 'flight', id: 'a', fly: true})).toBe(true)
  })

  it('always pans for pins', () => {
    expect(shouldFlyToSelection({kind: 'pin', id: 'a'})).toBe(true)
  })
})