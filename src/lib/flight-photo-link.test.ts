import {describe, expect, it} from 'vitest'

import {planPhotoLinks} from './flight-photo-link'

describe('planPhotoLinks', () => {
  const startedAt = '2026-05-14T18:00:00.000Z'
  const duration = 600

  it('links photos with takenAt in the window', () => {
    const plan = planPhotoLinks(
      [{_id: 'a', takenAt: '2026-05-14T18:05:00.000Z'}],
      startedAt,
      duration,
    )
    expect(plan.linkIds).toEqual(['a'])
    expect(plan.unlinkedLabels).toEqual([])
  })

  it('links using a DJI file name when takenAt is missing', () => {
    const plan = planPhotoLinks(
      [{_id: 'b', fileName: 'dji_fly_20260514_140500_x.jpg'}],
      startedAt,
      duration,
    )
    expect(plan.linkIds).toEqual(['b'])
  })

  it('links using EXIF DateTimeOriginal when takenAt and file name lack a time', () => {
    const plan = planPhotoLinks(
      [{_id: 'd', fileName: 'photo.jpg', exifDateTimeOriginal: '2026:05:14 18:05:00'}],
      startedAt,
      duration,
    )
    expect(plan.linkIds).toEqual(['d'])
  })

  it('lists drone photos with no usable time', () => {
    const plan = planPhotoLinks([{_id: 'c', fileName: 'DJI_0336.JPG'}], startedAt, duration)
    expect(plan.linkIds).toEqual([])
    expect(plan.unlinkedLabels).toEqual(['DJI_0336.JPG'])
  })
})