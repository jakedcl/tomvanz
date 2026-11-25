import {describe, expect, it} from 'vitest'

import type {FlightSeriesSample} from '@/lib/flight-log'
import {absoluteAltitudes, GROUND_CLEARANCE_METERS} from './altitude'
import {CameraFollower, easeBearing, easeToward, shortestAngleDelta, type CameraPose} from './camera-follow'
import {ReplayController, type ReplayFrame} from './replay-controller'
import {
  bearingDegrees,
  courseAt,
  defaultReplaySpeed,
  distanceMeters,
  flightReplayTrack,
  ROUTE_SPEED_MPS,
  routeReplayTrack,
  sampleReplay,
  timeAtDistance,
} from './replay-track'
import {fallbackHeight, simplifyTrack3D, type Point3} from './track3d'

const sample = (t: number, lng: number, lat: number, height = 0, heading = 0): FlightSeriesSample => ({
  t,
  lng,
  lat,
  height,
  speed: 5,
  heading,
  gimbalPitch: 0,
  battery: 90,
  mode: 'GPS',
})

describe('simplifyTrack3D', () => {
  it('collapses a straight, level line to its two ends', () => {
    const line: Point3[] = Array.from({length: 50}, (_, i) => [-74 + i * 0.0001, 40, 30])
    const out = simplifyTrack3D(line)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual([-74, 40, 30])
    expect(out[1]![0]).toBeCloseTo(-74 + 49 * 0.0001, 5)
  })

  it('keeps a climb: height counts as much as a turn', () => {
    const climb: Point3[] = [
      [-74, 40, 0],
      [-74.0001, 40, 0],
      [-74.0002, 40, 80],
      [-74.0003, 40, 0],
    ]
    expect(simplifyTrack3D(climb)).toHaveLength(4)
  })

  it('never returns more than maxPoints, and keeps both ends', () => {
    const wiggle: Point3[] = Array.from({length: 2000}, (_, i) => [-74 + i * 0.00005, 40 + Math.sin(i / 7) * 0.0005, 20 + Math.cos(i / 5) * 10])
    const out = simplifyTrack3D(wiggle, 1, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out[0]![0]).toBeCloseTo(wiggle[0]![0], 5)
    expect(out[out.length - 1]![0]).toBeCloseTo(wiggle[1999]![0], 5)
  })

  it('handles empty, single and repeated points', () => {
    expect(simplifyTrack3D([])).toEqual([])
    expect(simplifyTrack3D([[1, 2, 3]])).toEqual([[1, 2, 3]])
    expect(simplifyTrack3D([[1, 2, 3], [1, 2, 3]])).toEqual([[1, 2, 3]])
  })

  it('gives a flight with no log a modest flat height', () => {
    expect(fallbackHeight(undefined)).toBe(36)
    expect(fallbackHeight(100)).toBe(60)
    expect(fallbackHeight(500)).toBe(120)
    expect(fallbackHeight(5)).toBe(20)
  })
})

describe('absoluteAltitudes', () => {
  const points: Point3[] = [
    [0, 0, 0],
    [0, 0.001, 50],
    [0, 0.002, 100],
  ]

  it('is terrain at takeoff plus the exaggerated height above takeoff', () => {
    const out = absoluteAltitudes(points, {takeoffElevation: 300, exaggeration: 1.4, terrainAt: () => null})
    expect(out).toEqual([300, 300 + 70, 300 + 140])
  })

  it('never dips under the terrain, keeping a little clearance', () => {
    const ridge = (_lng: number, lat: number) => (lat > 0.0015 ? 600 : 300)
    const out = absoluteAltitudes(points, {takeoffElevation: 300, exaggeration: 1, terrainAt: ridge})
    expect(out[2]).toBe(600 + GROUND_CLEARANCE_METERS) // lifted over the ridge
    expect(out[1]).toBe(350) // fine where it was already above ground
  })

  it('lifts a point that would sit on the ground, and ignores negative heights', () => {
    const out = absoluteAltitudes([[0, 0, -5]], {takeoffElevation: 100, exaggeration: 1, terrainAt: () => 100})
    expect(out).toEqual([100 + GROUND_CLEARANCE_METERS])
  })
})

describe('replay tracks', () => {
  const series = [sample(1000, -74, 40, 0), sample(1010, -74, 40.001, 20), sample(1020, -74, 40.002, 40)]

  it('builds a flight replay from its log, in real time from zero', () => {
    const track = flightReplayTrack(series)!
    expect(track.kind).toBe('flight')
    expect(track.durationSeconds).toBe(20)
    expect(track.points.map((p) => p.t)).toEqual([0, 10, 20])
    expect(track.lengthMeters).toBeCloseTo(distanceMeters(-74, 40, -74, 40.002), 0)
    expect(track.start).toEqual({lng: -74, lat: 40})
  })

  it('refuses logs it cannot replay', () => {
    expect(flightReplayTrack(null)).toBeNull()
    expect(flightReplayTrack([sample(0, 1, 1)])).toBeNull()
    expect(flightReplayTrack([sample(5, 1, 1), sample(5, 2, 2)])).toBeNull() // no time passes
  })

  it('skips samples whose time does not move forward', () => {
    const track = flightReplayTrack([sample(0, 0, 0), sample(10, 0, 0.001), sample(10, 0, 0.0011), sample(20, 0, 0.002)])!
    expect(track.points.map((p) => p.t)).toEqual([0, 10, 20])
  })

  it('interpolates position and height at any time, and clamps outside it', () => {
    const track = flightReplayTrack(series)!
    const mid = sampleReplay(track, 5)
    expect(mid.lat).toBeCloseTo(40.0005, 6)
    expect(mid.height).toBeCloseTo(10, 6)
    expect(mid.fraction).toBeCloseTo(0.25, 6)
    expect(sampleReplay(track, -3).t).toBe(0)
    expect(sampleReplay(track, 999).fraction).toBe(1)
  })

  it('points the course along the direction of travel', () => {
    const north = flightReplayTrack(series)!
    expect(courseAt(north, 10)).toBeCloseTo(0, 0)
    const east = flightReplayTrack([sample(0, -74, 40), sample(10, -73.999, 40), sample(20, -73.998, 40)])!
    expect(courseAt(east, 10)).toBeCloseTo(90, 0)
  })

  it('falls back to the logged heading when it never moves', () => {
    const still = flightReplayTrack([sample(0, -74, 40, 5, 123), sample(10, -74, 40, 5, 123)])!
    expect(courseAt(still, 5)).toBe(123)
  })

  it('replays a route at a steady pace by distance, faster for a bike than a hike', () => {
    const coords: [number, number][] = [[-74, 40], [-74, 40.01], [-74, 40.02]]
    const bike = routeReplayTrack(coords, 'bike')!
    const hike = routeReplayTrack(coords, 'hike')!
    expect(bike.kind).toBe('route')
    expect(bike.durationSeconds).toBeCloseTo(bike.lengthMeters / ROUTE_SPEED_MPS.bike!, 5)
    expect(hike.durationSeconds).toBeGreaterThan(bike.durationSeconds)
    // halfway by distance is halfway by time
    expect(sampleReplay(bike, bike.durationSeconds / 2).lat).toBeCloseTo(40.01, 4)
    expect(sampleReplay(bike, 10).height).toBe(0)
  })

  it('drops repeated points and refuses a route with no length', () => {
    expect(routeReplayTrack([[1, 1]])).toBeNull()
    expect(routeReplayTrack([[1, 1], [1, 1]])).toBeNull()
    expect(routeReplayTrack([[1, 1], [1, 1], [1, 1.01]])!.points).toHaveLength(2)
  })

  it('finds the time at a distance along the path', () => {
    const track = routeReplayTrack([[-74, 40], [-74, 40.01], [-74, 40.02]], 'bike')!
    expect(timeAtDistance(track, 0)).toBe(0)
    expect(timeAtDistance(track, track.lengthMeters)).toBeCloseTo(track.durationSeconds, 6)
    expect(timeAtDistance(track, track.lengthMeters / 2)).toBeCloseTo(track.durationSeconds / 2, 3)
    expect(timeAtDistance(track, -50)).toBe(0)
  })

  it('computes bearings around the compass', () => {
    expect(bearingDegrees(0, 0, 0, 1)).toBeCloseTo(0, 3)
    expect(bearingDegrees(0, 0, 1, 0)).toBeCloseTo(90, 3)
    expect(bearingDegrees(0, 0, 0, -1)).toBeCloseTo(180, 3)
    expect(bearingDegrees(0, 0, -1, 0)).toBeCloseTo(270, 3)
  })

  it('picks the slowest speed that watches in about a minute and a half', () => {
    expect(defaultReplaySpeed(60)).toBe(1)
    expect(defaultReplaySpeed(90)).toBe(1)
    expect(defaultReplaySpeed(300)).toBe(4)
    expect(defaultReplaySpeed(1200)).toBe(16)
    expect(defaultReplaySpeed(36000)).toBe(16)
  })
})

describe('camera easing', () => {
  it('finds the short way round the compass', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20)
    expect(shortestAngleDelta(10, 350)).toBe(-20)
    expect(shortestAngleDelta(0, 180)).toBe(-180)
    expect(shortestAngleDelta(90, 90)).toBe(0)
  })

  it('eases a bearing across north without spinning the long way', () => {
    const step = easeBearing(350, 10, 0.1, 1)
    expect(step).toBeGreaterThan(350)
    expect(step).toBeLessThan(360)
    let b = 350
    for (let i = 0; i < 200; i += 1) b = easeBearing(b, 10, 0.05, 1)
    expect(b).toBeCloseTo(10, 1)
  })

  it('does not move with no time passing, and lands on the target with a zero time constant', () => {
    expect(easeToward(5, 9, 0, 1)).toBe(5)
    expect(easeToward(5, 9, 1, 0)).toBe(9)
    expect(easeToward(0, 10, 1, 1)).toBeCloseTo(6.32, 1)
  })

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const whole = easeToward(0, 10, 0.2, 0.7)
    const halves = easeToward(easeToward(0, 10, 0.1, 0.7), 10, 0.1, 0.7)
    expect(halves).toBeCloseTo(whole, 8)
  })
})

describe('CameraFollower', () => {
  const target: CameraPose = {lng: -74, lat: 40, elevation: 300, bearing: 10, pitch: 66, zoom: 16}
  const start: CameraPose = {lng: -74.01, lat: 40.01, elevation: 0, bearing: 350, pitch: 0, zoom: 12}

  it('glides toward the target and is settled once it arrives', () => {
    const follower = new CameraFollower()
    follower.reset(start)
    expect(follower.isSettled(target)).toBe(false)
    let pose = start
    for (let i = 0; i < 400; i += 1) pose = follower.step(1 / 60, target)
    expect(pose.lng).toBeCloseTo(-74, 5)
    expect(pose.bearing).toBeCloseTo(10, 1)
    expect(pose.pitch).toBeCloseTo(66, 0)
    expect(follower.isSettled(target)).toBe(true)
  })

  it('turns across north the short way while it glides', () => {
    const follower = new CameraFollower()
    follower.reset(start)
    for (let i = 0; i < 20; i += 1) {
      const pose = follower.step(1 / 60, target)
      expect(pose.bearing > 340 || pose.bearing < 20).toBe(true)
    }
  })

  it('takes small steps (never jumps) in one frame', () => {
    const follower = new CameraFollower()
    follower.reset(start)
    const pose = follower.step(1 / 60, target)
    expect(Math.abs(pose.lng - start.lng)).toBeLessThan(Math.abs(target.lng - start.lng) * 0.1)
    expect(pose.pitch).toBeLessThan(5)
  })

  it('starts on the target when it has no pose yet', () => {
    const follower = new CameraFollower()
    expect(follower.step(1 / 60, target)).toEqual(target)
  })
})

describe('ReplayController', () => {
  function rig() {
    let clock = 0
    const queue: (() => void)[] = []
    const controller = new ReplayController({
      now: () => clock,
      raf: (cb) => queue.push(cb),
      caf: () => {
        queue.length = 0
      },
    })
    const advance = (ms: number, frames = 1) => {
      for (let i = 0; i < frames; i += 1) {
        clock += ms / frames
        const next = queue.splice(0)
        next.forEach((cb) => cb())
      }
    }
    return {controller, advance}
  }
  const flight = () => flightReplayTrack([sample(0, -74, 40, 0), sample(100, -74, 40.01, 50), sample(200, -74, 40.02, 0)])!

  it('starts paused and hidden, at a speed that suits the length', () => {
    const {controller} = rig()
    controller.load(flight())
    expect(controller.getState()).toMatchObject({hasTrack: true, playing: false, visible: false, speed: 4, kind: 'flight'})
  })

  it('plays in real time scaled by the speed', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    controller.setSpeed(4)
    controller.play()
    advance(2000, 20) // 2 s of wall time -> 8 s of flight
    expect(controller.getFrame()!.t).toBeCloseTo(8, 0)
    expect(controller.getState()).toMatchObject({playing: true, visible: true})
  })

  it('does not leap after a slow frame', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    controller.setSpeed(1)
    controller.play()
    advance(5000, 1) // one frame after 5 s asleep
    expect(controller.getFrame()!.t).toBeLessThanOrEqual(0.26)
  })

  it('pauses, resumes from where it was, and stops at the end', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    controller.setSpeed(16)
    controller.play()
    advance(1000, 10) // 16 s
    controller.pause()
    const paused = controller.getFrame()!.t
    advance(1000, 10)
    expect(controller.getFrame()!.t).toBe(paused)
    controller.play()
    advance(20000, 400)
    expect(controller.getState().playing).toBe(false)
    expect(controller.getFrame()!.fraction).toBe(1)
    controller.play() // at the end, play starts over
    expect(controller.getFrame()!.t).toBe(0)
    expect(controller.getState().playing).toBe(true)
  })

  it('scrubbing pauses, shows the marker, and moves it', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    controller.setSpeed(4)
    controller.play()
    advance(500, 5)
    controller.seekSeconds(100)
    expect(controller.getState()).toMatchObject({playing: false, visible: true})
    expect(controller.getFrame()!.lat).toBeCloseTo(40.01, 5)
    advance(1000, 10)
    expect(controller.getFrame()!.t).toBe(100) // stays put
    controller.seekFraction(0.25)
    expect(controller.getFrame()!.t).toBe(50)
    controller.seekMeters(controller.getTrack()!.lengthMeters)
    expect(controller.getFrame()!.fraction).toBe(1)
    controller.seekSeconds(-5)
    expect(controller.getFrame()!.t).toBe(0)
  })

  it('sends a frame for every tick and for every seek, to every listener, until unsubscribed', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    const a: ReplayFrame[] = []
    const stop = controller.subscribeFrames((f) => a.push(f))
    controller.seekSeconds(10)
    controller.play()
    advance(100, 4)
    expect(a.length).toBeGreaterThanOrEqual(5)
    stop()
    const count = a.length
    advance(100, 4)
    expect(a.length).toBe(count)
  })

  it('tells state listeners only when something they show changes, not on every frame', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    let changes = 0
    controller.subscribeState(() => (changes += 1))
    controller.play()
    const afterPlay = changes
    advance(1000, 20)
    expect(changes).toBe(afterPlay)
    controller.setSpeed(1)
    expect(changes).toBe(afterPlay + 1)
    controller.setSpeed(1)
    expect(changes).toBe(afterPlay + 1)
  })

  it('follows the camera until the person takes over, and a re-center resumes it', () => {
    const {controller} = rig()
    controller.load(flight())
    controller.play()
    expect(controller.getState().following).toBe(true)
    controller.releaseCamera()
    expect(controller.getState().following).toBe(false)
    controller.recenter()
    expect(controller.getState().following).toBe(true)
  })

  it('never follows by itself with reduced motion, and re-center does nothing', () => {
    const {controller} = rig()
    controller.setReducedMotion(true)
    controller.load(flight())
    controller.play()
    expect(controller.getState()).toMatchObject({following: false, reducedMotion: true})
    controller.recenter()
    expect(controller.getState().following).toBe(false)
  })

  it('loading another path (or none) starts over', () => {
    const {controller} = rig()
    controller.load(flight())
    controller.play()
    controller.load(null)
    expect(controller.getState()).toMatchObject({hasTrack: false, playing: false, visible: false})
    expect(controller.getFrame()).toBeNull()
    controller.play() // nothing to play: no effect
    expect(controller.getState().playing).toBe(false)
  })

  it('says when a replay plays to its end, once, and not for a pause, a scrub or a reload', () => {
    const {controller, advance} = rig()
    controller.load(flight())
    let ended = 0
    controller.subscribeEnded(() => (ended += 1))
    controller.setSpeed(16)
    controller.play()
    advance(2000, 40)
    controller.pause()
    controller.seekFraction(1)
    controller.load(flight())
    expect(ended).toBe(0)
    controller.setSpeed(16)
    controller.play()
    advance(20000, 400)
    expect(ended).toBe(1)
    expect(controller.getState().playing).toBe(false)
    advance(5000, 50)
    expect(ended).toBe(1)
  })

  it('hide() takes the marker away but keeps the path', () => {
    const {controller} = rig()
    controller.load(flight())
    controller.seekSeconds(50)
    controller.hide()
    expect(controller.getState()).toMatchObject({visible: false, playing: false, hasTrack: true})
    expect(controller.getFrame()!.t).toBe(0)
  })
})
