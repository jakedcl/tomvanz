import {describe, expect, it} from 'vitest'
import {sheetHeights, snapSheet, stepSheet} from './sheet-snap'

const heights = sheetHeights(800, 100)

describe('map sheet snaps', () => {
  it('leaves room above full and includes the peek content on a short screen', () => {
    expect(heights).toEqual({peek: 100, half: 416, full: 788})
    expect(sheetHeights(160, 110)).toEqual({peek: 110, half: 110, full: 148})
    expect(sheetHeights(70, 110)).toEqual({peek: 70, half: 70, full: 70})
  })

  it('chooses the closest stop on a slow drag, keeping the current one on ties', () => {
    expect(snapSheet('peek', 370, 0.1, heights)).toBe('half')
    expect(snapSheet('half', 735, 0, heights)).toBe('full')
    expect(snapSheet('half', 145, -0.1, heights)).toBe('peek')
    expect(snapSheet('half', (heights.peek + heights.half) / 2, 0, heights)).toBe('half')
  })

  it('steps one stop on a fast flick regardless of distance', () => {
    expect(snapSheet('peek', 115, 0.7, heights)).toBe('half')
    expect(snapSheet('half', 430, 0.7, heights)).toBe('full')
    expect(snapSheet('full', 250, -0.8, heights)).toBe('half')
  })

  it('stays at the nearest end when flicking past it', () => {
    expect(stepSheet('peek', -1)).toBe('peek')
    expect(stepSheet('full', 1)).toBe('full')
  })
})
