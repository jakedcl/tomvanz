import {describe, expect, it} from 'vitest'

import {
  easternLocalToUtcIso,
  effectiveTakenAt,
  inferTakenAtFromFileName,
  isUsEasternDaylightTime,
  takenAtFromExifDateTime,
} from './photo-taken-at'

describe('isUsEasternDaylightTime', () => {
  it('knows EDT vs EST around the DST boundaries', () => {
    expect(isUsEasternDaylightTime(2026, 3, 7)).toBe(false)
    expect(isUsEasternDaylightTime(2026, 3, 9)).toBe(true)
    expect(isUsEasternDaylightTime(2026, 10, 11)).toBe(true)
    expect(isUsEasternDaylightTime(2026, 11, 2)).toBe(false)
  })
})

describe('easternLocalToUtcIso', () => {
  it('adds 4 hours in EDT', () => {
    expect(easternLocalToUtcIso(2026, 10, 11, 11, 9, 52)).toBe('2026-10-11T15:09:52.000Z')
  })

  it('adds 5 hours in EST', () => {
    expect(easternLocalToUtcIso(2026, 1, 15, 12, 0, 0)).toBe('2026-01-15T17:00:00.000Z')
  })
})

describe('inferTakenAtFromFileName', () => {
  it('reads DJI Fly export timestamps as America/New_York', () => {
    expect(inferTakenAtFromFileName('dji_fly_20261011_110952_91_photo_optimized.jpg')).toBe(
      '2026-10-11T15:09:52.000Z',
    )
  })

  it('reads DJI camera roll timestamps as UTC fields', () => {
    expect(inferTakenAtFromFileName('DJI_20230514143000_0405_D.JPG')).toBe('2023-05-14T14:30:00.000Z')
  })
})

describe('takenAtFromExifDateTime', () => {
  it('parses EXIF date strings', () => {
    expect(takenAtFromExifDateTime('2026:05:14 18:05:00')).toBe('2026-05-14T18:05:00.000Z')
  })
})

describe('effectiveTakenAt', () => {
  it('prefers explicit takenAt over the file name', () => {
    expect(effectiveTakenAt('2026-01-01T12:00:00.000Z', 'dji_fly_20261011_110952_x.jpg')).toBe(
      '2026-01-01T12:00:00.000Z',
    )
  })

  it('falls back to EXIF when takenAt and file name lack a time', () => {
    expect(effectiveTakenAt(undefined, 'vacation.jpg', '2026:05:14 18:05:00')).toBe(
      '2026-05-14T18:05:00.000Z',
    )
  })
})