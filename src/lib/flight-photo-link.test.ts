import {describe, expect, it} from 'vitest'

import {planPhotoLinks} from './flight-photo-link'

describe('planPhotoLinks', () => {
  const startedAt = '2026-05-14T18:00:00.000Z'
  const duration = 600
  const aircraft = 'DJI Mini 3'

  it('links drone photos with takenAt in the window and matching camera code', () => {
    const plan = planPhotoLinks(
      [{_id: 'a', takenAt: '2026-05-14T18:05:00.000Z', fileName: 'DJI_0001.JPG', cameraModel: 'FC3682'}],
      startedAt,
      duration,
      {aircraft},
    )
    expect(plan.linkIds).toEqual(['a'])
    expect(plan.unlinkedLabels).toEqual([])
  })

  it('links using a DJI file name when takenAt is missing but filename provides time', () => {
    const plan = planPhotoLinks(
      [{_id: 'b', fileName: 'dji_fly_20260514_140500_x.jpg', cameraModel: 'FC3682'}],
      '2026-05-14T18:00:00.000Z',
      duration,
      {aircraft},
    )
    expect(plan.linkIds).toEqual(['b'])
  })

  it('links using EXIF DateTimeOriginal when takenAt and file name lack a time', () => {
    const plan = planPhotoLinks(
      [
        {
          _id: 'd',
          fileName: 'DJI_photo.jpg',
          exifDateTimeOriginal: '2026:05:14 14:05:00',
          cameraModel: 'FC3682',
        },
      ],
      startedAt,
      duration,
      {aircraft},
    )
    expect(plan.linkIds).toEqual(['d'])
  })

  it('lists drone photos with no usable time', () => {
    const plan = planPhotoLinks(
      [{_id: 'c', fileName: 'DJI_0336.JPG', cameraModel: 'FC3682'}],
      startedAt,
      duration,
      {aircraft},
    )
    expect(plan.linkIds).toEqual([])
    expect(plan.unlinkedLabels).toEqual(['DJI_0336.JPG'])
  })
})