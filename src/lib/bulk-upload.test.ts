import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

import {
  guessActivity,
  flightFromUpload,
  isFlightLogFile,
  isGpxFile,
  isPhotoFile,
  photoFromUpload,
  plausibleTime,
  readPhotoMeta,
  routeFromUpload,
  runPool,
  titleFromFileName,
} from './bulk-upload'
import {lineLengthMeters} from './simplify-route'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

describe('readPhotoMeta', () => {
  it('reads GPS and the time taken from a photo that has them', async () => {
    const meta = await readPhotoMeta(fixture('drone-gps.jpg'))
    expect(meta.lat).toBeCloseTo(44.1128, 3)
    expect(meta.lng).toBeCloseTo(-73.9239, 3) // west is negative
    expect(meta.takenAt).toMatch(/^2026-10-1[01]T/)
  })

  it('returns nothing (and does not throw) for a photo without GPS or dates', async () => {
    expect(await readPhotoMeta(fixture('no-gps.jpg'))).toEqual({})
  })

  it('returns nothing for data that is not an image at all', async () => {
    expect(await readPhotoMeta(new Uint8Array([1, 2, 3, 4]))).toEqual({})
  })
})

describe('isPhotoFile', () => {
  it('accepts photos by type or extension and rejects other files', () => {
    expect(isPhotoFile({name: 'DJI_0336.JPG', type: 'image/jpeg'})).toBe(true)
    expect(isPhotoFile({name: 'IMG_1.HEIC', type: ''})).toBe(true)
    expect(isPhotoFile({name: 'clip.mp4', type: 'video/mp4'})).toBe(false)
    expect(isPhotoFile({name: 'DJI_0336.SRT', type: ''})).toBe(false)
  })
})

describe('photoFromUpload', () => {
  it('builds a Photo with the image, location and date when known', () => {
    const doc = photoFromUpload('image-abc-800x600-jpg', {lat: 44.1, lng: -73.9, takenAt: '2026-10-11T10:00:00.000Z'})
    expect(doc).toEqual({
      _type: 'photo',
      image: {_type: 'image', asset: {_type: 'reference', _ref: 'image-abc-800x600-jpg'}},
      location: {_type: 'geopoint', lat: 44.1, lng: -73.9},
      takenAt: '2026-10-11T10:00:00.000Z',
    })
  })

  it('leaves out location, date and title when there are none', () => {
    const doc = photoFromUpload('image-abc-800x600-jpg', {})
    expect(doc).not.toHaveProperty('location')
    expect(doc).not.toHaveProperty('takenAt')
    expect(doc).not.toHaveProperty('title')
  })

  it('adds a trimmed title, and ignores a blank one', () => {
    expect(photoFromUpload('image-abc-800x600-jpg', {}, '  Monguap  ')).toMatchObject({title: 'Monguap'})
    expect(photoFromUpload('image-abc-800x600-jpg', {}, '   ')).not.toHaveProperty('title')
    expect(photoFromUpload('image-abc-800x600-jpg', {}, '')).not.toHaveProperty('title')
  })
})

describe('runPool', () => {
  it('runs everything but never more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      done.push(n)
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('DJI flight logs', () => {
  it('accepts DJI flight log file names and rejects other text files', () => {
    expect(isFlightLogFile({name: 'FlightRecord_2026-05-14_[10-00-58].txt'})).toBe(true)
    expect(isFlightLogFile({name: 'DJIFlightRecord_2024.txt'})).toBe(true)
    expect(isFlightLogFile({name: 'notes.txt'})).toBe(false)
    expect(isFlightLogFile({name: 'readme.TXT'})).toBe(false)
  })

  it('builds a Flight document from parsed log fields', () => {
    const doc = flightFromUpload('file-abc-txt', {
      title: 'May 14 · Emerson Hill',
      defaultTitle: 'May 14 · Emerson Hill',
      durationSeconds: 600,
      distanceMeters: 1200,
      maxHeightMeters: 90,
      aircraft: 'DJI Mini 3',
      displayCoordinates: '[[-74,40]]',
      series: '[]',
      videoSegments: [],
      hasGps: true,
      startedAt: '2026-05-14T14:00:00.000Z',
      place: 'Emerson Hill',
    })
    expect(doc._type).toBe('flight')
    expect(doc.title).toBe('May 14 · Emerson Hill')
    expect(doc.log.asset._ref).toBe('file-abc-txt')
    expect(doc.distanceMeters).toBe(1200)
  })
})

describe('GPX routes', () => {
  it('spots GPX files by extension, whatever the case', () => {
    expect(isGpxFile({name: 'Afternoon_Ride.gpx'})).toBe(true)
    expect(isGpxFile({name: 'RIDE.GPX'})).toBe(true)
    expect(isGpxFile({name: 'ride.gpx.txt'})).toBe(false)
    expect(isGpxFile({name: 'DJI_0336.JPG'})).toBe(false)
  })

  it('makes a readable title from a file name', () => {
    expect(titleFromFileName('Afternoon_Ride.gpx')).toBe('Afternoon Ride')
    expect(titleFromFileName('Tuckerman Ravine to Mt. Washington .gpx')).toBe('Tuckerman Ravine to Mt. Washington')
    expect(titleFromFileName('gothics-armstrong__upper.gpx')).toBe('gothics armstrong upper')
  })

  it('guesses the activity only from plain words', () => {
    expect(guessActivity('cycling')).toBe('bike')
    expect(guessActivity('Road Biking')).toBe('bike')
    expect(guessActivity('hiking')).toBe('hike')
    expect(guessActivity('Walk')).toBe('hike')
    expect(guessActivity('running')).toBeUndefined()
    expect(guessActivity('1')).toBeUndefined()
    expect(guessActivity(undefined)).toBeUndefined()
  })

  it('ignores bogus dates', () => {
    expect(plausibleTime(new Date('2026-08-29T20:27:00Z'))).toBe('2026-08-29T20:27:00.000Z')
    expect(plausibleTime(new Date('1970-01-01T00:00:00Z'))).toBeUndefined()
    expect(plausibleTime(new Date('2999-01-01T00:00:00Z'))).toBeUndefined()
    expect(plausibleTime(new Date('nope'))).toBeUndefined()
    expect(plausibleTime(null)).toBeUndefined()
  })

  it('builds a Route the same way the Route form does', () => {
    const coordinates: [number, number][] = [
      [-74.0, 40.7],
      [-74.0, 40.7],
      [-74.001, 40.701],
      [-74.002, 40.7],
    ]
    const doc = routeFromUpload('file-abc-gpx', {
      title: '  Afternoon Ride ',
      activity: 'bike',
      coordinates,
      startedAt: '2026-08-29T20:27:00.000Z',
    })
    expect(doc).toMatchObject({
      _type: 'track',
      title: 'Afternoon Ride',
      activity: 'bike',
      file: {_type: 'file', asset: {_type: 'reference', _ref: 'file-abc-gpx'}},
      route: {type: 'LineString', coordinates: JSON.stringify(coordinates)},
      startedAt: '2026-08-29T20:27:00.000Z',
    })
    // Length is of the full line; the map copy is simplified (the repeated point is dropped).
    expect(doc.distanceMeters).toBeCloseTo(lineLengthMeters(coordinates), 0)
    expect(JSON.parse(doc.displayCoordinates)).toHaveLength(4 - 1)
  })

  it('leaves the date out when the file has none', () => {
    const doc = routeFromUpload('file-abc-gpx', {title: 'x', activity: 'hike', coordinates: [[0, 0], [0.01, 0.01]]})
    expect(doc).not.toHaveProperty('startedAt')
  })
})
