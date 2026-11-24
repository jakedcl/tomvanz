import {describe, expect, it} from 'vitest'

import {effectiveTakenAt, inferTakenAtFromFileName} from './photo-taken-at'

describe('inferTakenAtFromFileName', () => {
  it('reads DJI Fly export timestamps', () => {
    expect(inferTakenAtFromFileName('dji_fly_20261011_110952_91_photo_optimized.jpg')).toBe(
      '2026-10-11T11:09:52.000Z',
    )
  })

  it('reads DJI camera roll timestamps', () => {
    expect(inferTakenAtFromFileName('DJI_20230514143000_0405_D.JPG')).toBe('2023-05-14T14:30:00.000Z')
  })
})

describe('effectiveTakenAt', () => {
  it('prefers explicit takenAt over the file name', () => {
    expect(effectiveTakenAt('2026-01-01T12:00:00.000Z', 'dji_fly_20261011_110952_x.jpg')).toBe(
      '2026-01-01T12:00:00.000Z',
    )
  })
})