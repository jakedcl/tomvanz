import {afterEach, describe, expect, it, vi} from 'vitest'

import {compactFlightTrack, MAX_TUBE_POINTS} from './compact-track'
import {clearFlightTrackCache, loadFlightTracks} from './flight-tracks-client'
import {buildTube, mergeTubes, type Vec3} from './tube-geometry'

const line = (n: number, f: (i: number) => Vec3): Vec3[] => Array.from({length: n}, (_, i) => f(i))

describe('buildTube', () => {
  const path = line(10, (i) => ({x: i * 5, y: Math.sin(i) * 3, z: 40 + i}))

  it('makes one ring per point and two triangles per side per segment', () => {
    const tube = buildTube(path, 5)
    expect(tube.center.length).toBe(10 * 5 * 3)
    expect(tube.offset.length).toBe(10 * 5 * 3)
    expect(tube.index.length).toBe(9 * 5 * 6)
    expect(Math.max(...tube.index)).toBe(10 * 5 - 1)
  })

  it('has unit offsets that point away from the path, never NaN', () => {
    const tube = buildTube(path, 6)
    for (let v = 0; v < tube.offset.length; v += 3) {
      const len = Math.hypot(tube.offset[v]!, tube.offset[v + 1]!, tube.offset[v + 2]!)
      expect(len).toBeCloseTo(1, 4)
    }
    expect(tube.center.every(Number.isFinite)).toBe(true)
  })

  it('keeps each ring flat against the path (offsets are across it, not along it)', () => {
    const straight = line(6, (i) => ({x: i * 10, y: 0, z: 30}))
    const tube = buildTube(straight, 5)
    for (let v = 0; v < tube.offset.length; v += 3) expect(Math.abs(tube.offset[v]!)).toBeLessThan(1e-5) // none along x
  })

  it('copes with a straight-up climb, a straight-down drop and repeated points', () => {
    const climb = buildTube(line(5, (i) => ({x: 0, y: 0, z: i * 20})), 5)
    expect(climb.offset.every(Number.isFinite)).toBe(true)
    const repeated = buildTube([{x: 0, y: 0, z: 5}, {x: 0, y: 0, z: 5}, {x: 10, y: 0, z: 5}], 5)
    expect(repeated.offset.every(Number.isFinite)).toBe(true)
    expect(repeated.center.every(Number.isFinite)).toBe(true)
  })

  it('does not twist: neighbouring rings line up', () => {
    const tube = buildTube(line(30, (i) => ({x: i * 4, y: Math.sin(i / 3) * 20, z: 50 + Math.cos(i / 4) * 10})), 5)
    for (let i = 0; i < 29; i += 1) {
      const a = i * 5 * 3
      const b = (i + 1) * 5 * 3
      const d = Math.hypot(tube.offset[a]! - tube.offset[b]!, tube.offset[a + 1]! - tube.offset[b + 1]!, tube.offset[a + 2]! - tube.offset[b + 2]!)
      expect(d).toBeLessThan(0.6) // the same vertex of the next ring is nearby
    }
  })

  it('says how far along its path each ring is, from 0 to 1, evenly for an even path', () => {
    const tube = buildTube(line(5, (i) => ({x: i * 10, y: 0, z: 30})), 4)
    expect(tube.along.length).toBe(5 * 4)
    const rings = [0, 1, 2, 3, 4].map((i) => tube.along[i * 4]!)
    expect(rings).toEqual([0, 0.25, 0.5, 0.75, 1])
    for (let i = 0; i < 5; i += 1) expect(new Set([...tube.along.slice(i * 4, i * 4 + 4)]).size).toBe(1) // same for the whole ring
  })

  it('keeps each merged tube’s own 0 to 1', () => {
    const a = buildTube(line(3, (i) => ({x: i, y: 0, z: 0})), 3)
    const b = buildTube(line(3, (i) => ({x: i * 100, y: 5, z: 0})), 3)
    const merged = mergeTubes([a, b])
    expect(merged.along.length).toBe(a.along.length + b.along.length)
    expect(merged.along[a.along.length]).toBe(0)
    expect(merged.along[merged.along.length - 1]).toBe(1)
  })

  it('returns nothing for fewer than two points', () => {
    expect(buildTube([], 5).index.length).toBe(0)
    expect(buildTube([{x: 0, y: 0, z: 0}], 5).index.length).toBe(0)
  })

  it('merges tubes into one, with each one’s indexes still pointing at its own vertices', () => {
    const a = buildTube(line(3, (i) => ({x: i, y: 0, z: 0})), 4)
    const b = buildTube(line(4, (i) => ({x: i, y: 9, z: 0})), 4)
    const merged = mergeTubes([a, b])
    expect(merged.center.length).toBe(a.center.length + b.center.length)
    expect(merged.index.length).toBe(a.index.length + b.index.length)
    const firstOfB = merged.index[a.index.length]!
    expect(firstOfB).toBe(b.index[0]! + 3 * 4)
    expect(merged.center[firstOfB * 3 + 1]).toBe(9)
    expect(mergeTubes([]).index.length).toBe(0)
  })
})

describe('compactFlightTrack', () => {
  const sample = (t: number, lng: number, lat: number, height: number) => ({t, lng, lat, height, speed: 1, heading: 0, gimbalPitch: 0, battery: 50, mode: 'GPS'})

  it('turns a log into thinned lng/lat/height points', () => {
    const series = JSON.stringify(Array.from({length: 600}, (_, i) => sample(i, -74 + i * 0.00002, 40 + Math.sin(i / 20) * 0.001, 30 + Math.sin(i / 30) * 20)))
    const track = compactFlightTrack(series)!
    expect(track.length).toBeGreaterThan(5)
    expect(track.length).toBeLessThanOrEqual(MAX_TUBE_POINTS)
    expect(track[0]).toHaveLength(3)
    expect(Math.max(...track.map((p) => p[2]))).toBeGreaterThan(40)
  })

  it('returns null for no log, a broken log, or one with nothing usable', () => {
    expect(compactFlightTrack(null)).toBeNull()
    expect(compactFlightTrack('')).toBeNull()
    expect(compactFlightTrack('not json')).toBeNull()
    expect(compactFlightTrack('{"a":1}')).toBeNull()
    expect(compactFlightTrack('[]')).toBeNull()
    expect(compactFlightTrack(JSON.stringify([sample(0, 1, 1, 0)]))).toBeNull()
    expect(compactFlightTrack(JSON.stringify([{t: 0}, {t: 1}]))).toBeNull()
  })

  it('treats a missing height as on the ground', () => {
    const track = compactFlightTrack(JSON.stringify([{lng: 1, lat: 1}, {lng: 1.01, lat: 1}]))!
    expect(track.map((p) => p[2])).toEqual([0, 0])
  })
})

describe('loadFlightTracks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearFlightTrackCache()
  })

  const fakeFetch = () =>
    vi.fn(async (url: string) => {
      const ids = decodeURIComponent(new URL(url, 'http://x').searchParams.get('ids') ?? '').split(',')
      const tracks = Object.fromEntries(ids.map((id) => [id, id === 'nolog' ? null : [[1, 2, 3], [1, 2.1, 4]]]))
      return {ok: true, json: async () => ({tracks})} as Response
    })

  it('fetches in small batches and only fetches each flight once', async () => {
    const fetchMock = fakeFetch()
    vi.stubGlobal('fetch', fetchMock)
    const ids = Array.from({length: 30}, (_, i) => `f${i}`)
    const first = await loadFlightTracks(ids)
    expect(first.size).toBe(30)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 12 + 12 + 6
    const again = await loadFlightTracks(ids.slice(0, 5))
    expect(again.size).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports a flight with no log as null', async () => {
    vi.stubGlobal('fetch', fakeFetch())
    const result = await loadFlightTracks(['a', 'nolog'])
    expect(result.get('nolog')).toBeNull()
    expect(result.get('a')).toEqual([[1, 2, 3], [1, 2.1, 4]])
  })

  it('shares one download between overlapping requests', async () => {
    const fetchMock = fakeFetch()
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([loadFlightTracks(['x', 'y']), loadFlightTracks(['y', 'z'])])
    expect(a.size).toBe(2)
    expect(b.size).toBe(2)
    const requested = fetchMock.mock.calls.flatMap(([url]) => decodeURIComponent(new URL(url, 'http://x').searchParams.get('ids') ?? '').split(','))
    expect(requested.filter((id) => id === 'y')).toHaveLength(1)
  })

  it('leaves out flights whose batch fails, and lets them be asked for again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, json: async () => ({})}) as Response))
    const failed = await loadFlightTracks(['a', 'b'])
    expect(failed.size).toBe(0)
    const fetchMock = fakeFetch()
    vi.stubGlobal('fetch', fetchMock)
    const retry = await loadFlightTracks(['a', 'b'])
    expect(retry.size).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
