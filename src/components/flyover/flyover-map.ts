import type {Map as MapLibreMap} from 'maplibre-gl'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {neonTrailColor, trackColor} from '@/lib/track-color'
import {lineCoordinates, type FlightDoc, type MapData, type SelectedItem} from '@/lib/sanity/types'
import {GROUND_CLEARANCE_METERS} from '@/lib/flyover/altitude'
import {CameraFollower, easeToward, FOLLOW_PITCH, FOLLOW_ZOOM, type CameraPose} from '@/lib/flyover/camera-follow'
import {loadFlightTracks} from '@/lib/flyover/flight-tracks-client'
import type {ReplayController, ReplayFrame} from '@/lib/flyover/replay-controller'
import {distanceMeters} from '@/lib/flyover/replay-track'
import {LowPass} from '@/lib/flyover/smooth'
import {fallbackHeight, type Point3} from '@/lib/flyover/track3d'
import type {FlyoverLayer, MarkerState, TubeFlight} from './flyover-layer'

/** Flights only become tubes once the map is tilted past this many degrees. */
export const TUBE_MIN_PITCH = 20
/** Most tubes built at once; the nearest to the middle of the view win. */
const MAX_TUBES = 60
/** How far past the edge of the screen (as a share of its size) flights still get tubes, so panning feels solid. */
const VIEW_PADDING = 0.25
/** While the map keeps moving (the follow camera never stops), the tubes are still brought up to date this often. */
const MAX_SYNC_WAIT_MS = 500
/** How long the camera takes to glide back to where it was when a replay ends. */
const RETURN_DURATION_MS = 2400
/** The trail's name on the map (routes; a flight's trail is drawn on its tube instead). */
const TRAIL_SOURCE = 'replay-trail-src'
const TRAIL_LAYER = 'replay-trail'
/** After a replay ends: how long the neon takes to fade back, and how long the marker takes to fade away. */
const NEON_FADE_SECONDS = 1.8
const MARKER_FADE_DELAY_SECONDS = 0.5
const MARKER_FADE_SECONDS = 1.2
/** The camera stays at least this far above the ground behind the marker (meters, as drawn). */
const CAMERA_CLEARANCE_METERS = 30
/** The clock waits this long at the start for the camera to fly in (a safety: it's shortened once the fly-in starts). */
const INTRO_WAIT_MS = 4000

export type FlyoverDeps = {
  getData: () => MapData
  getSelected: () => SelectedItem | null
  isThreeD: () => boolean
  replay: ReplayController
  /** Turns 3D mode off or on (used to put the map back how it was when a replay ends). */
  requestThreeD: (on: boolean) => void
  /** Draws the replay marker with plain DOM, if the 3D layer can't be used (no WebGL2, failed to load). */
  fallbackMarker: {show: (frame: ReplayFrame) => void; hide: () => void}
}

export type FlyoverHandle = {
  /** Call when the flights shown, the selection, or 3D mode changed. */
  sync: () => void
  /** The flight whose floating tube is nearest a screen point (within `maxPx`), if tubes are showing. */
  pickFlight: (x: number, y: number, maxPx?: number) => {id: string; distance: number} | null
  dispose: () => void
}

type Bounds = {west: number; south: number; east: number; north: number}

function flightBounds(flight: FlightDoc): Bounds | null {
  const coords = lineCoordinates(flight.path)
  if (coords.length < 2) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [lng, lat] of coords) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return {west, south, east, north}
}

/**
 * Everything the map does for the 3D flyover, in one place: floating flight tubes (only built when the map is
 * tilted, only for flights near the screen, only for the ones the filters leave), the replay marker, and the
 * camera that follows it. three.js is loaded the first time any of it is needed.
 */
export function createFlyover(map: MapLibreMap, deps: FlyoverDeps): FlyoverHandle {
  const {replay} = deps
  let layer: FlyoverLayer | null = null
  let layerPromise: Promise<FlyoverLayer | null> | null = null
  let layerFailed = false
  let disposed = false
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let syncToken = 0
  const boundsCache = new Map<string, Bounds | null>()

  const ensureLayer = (): Promise<FlyoverLayer | null> => {
    if (layer) return Promise.resolve(layer)
    if (layerFailed || disposed) return Promise.resolve(null)
    layerPromise ??= import('./flyover-layer')
      .then(({FlyoverLayer}) => {
        if (disposed) return null
        const created = new FlyoverLayer({tubeColor: FLIGHT_PATH_COLOR})
        map.addLayer(created)
        layer = created
        return created
      })
      .catch(() => {
        layerFailed = true
        return null
      })
    return layerPromise
  }

  // ---- Tubes ----

  const tubesWanted = () => deps.isThreeD() && map.getPitch() > TUBE_MIN_PITCH && Boolean(map.getTerrain())

  const selectedFlightId = () => {
    const selected = deps.getSelected()
    return selected?.kind === 'flight' ? selected.id : null
  }

  function flightsInView(): FlightDoc[] {
    const view = map.getBounds()
    const padLng = (view.getEast() - view.getWest()) * VIEW_PADDING
    const padLat = (view.getNorth() - view.getSouth()) * VIEW_PADDING
    const west = view.getWest() - padLng
    const east = view.getEast() + padLng
    const south = view.getSouth() - padLat
    const north = view.getNorth() + padLat
    const center = map.getCenter()
    const selectedId = selectedFlightId()
    const inView: {flight: FlightDoc; distance: number}[] = []
    for (const flight of deps.getData().flights) {
      let bounds = boundsCache.get(flight._id)
      if (bounds === undefined) {
        bounds = flightBounds(flight)
        boundsCache.set(flight._id, bounds)
      }
      if (!bounds) continue
      const visible = bounds.east >= west && bounds.west <= east && bounds.north >= south && bounds.south <= north
      if (!visible && flight._id !== selectedId) continue
      const distance = Math.hypot((bounds.west + bounds.east) / 2 - center.lng, (bounds.south + bounds.north) / 2 - center.lat)
      inView.push({flight, distance: flight._id === selectedId ? -1 : distance})
    }
    return inView.sort((a, b) => a.distance - b.distance).slice(0, MAX_TUBES).map((item) => item.flight)
  }

  // Kept by flight so the same array comes back each time (the layer skips rebuilding what hasn't changed).
  const fallbackTracks = new Map<string, Point3[]>()
  const fallbackTrack = (flight: FlightDoc): Point3[] => {
    let track = fallbackTracks.get(flight._id)
    if (!track) {
      const height = fallbackHeight(flight.maxHeightMeters)
      track = lineCoordinates(flight.path).map(([lng, lat]): Point3 => [lng, lat, height])
      fallbackTracks.set(flight._id, track)
    }
    return track
  }

  async function syncTubesNow() {
    const token = ++syncToken
    if (disposed) return
    if (!tubesWanted()) {
      layer?.setFlights([])
      applyLineVisibility()
      return
    }
    const active = await ensureLayer()
    if (!active || token !== syncToken || disposed) return
    active.setSelected(selectedFlightId())
    const flights = flightsInView()
    const tracks = await loadFlightTracks(flights.map((flight) => flight._id))
    if (token !== syncToken || disposed || !tubesWanted()) return
    const items: TubeFlight[] = []
    for (const flight of flights) {
      const track = tracks.get(flight._id)
      if (track === undefined) continue // the download failed: leave it out rather than guess
      items.push({id: flight._id, points: track ?? fallbackTrack(flight)})
    }
    active.setFlights(items)
    applyLineVisibility()
  }

  let syncDueSince = 0
  const scheduleSync = (delay = 120) => {
    const now = performance.now()
    if (syncTimer) clearTimeout(syncTimer)
    else syncDueSince = now
    // Keep postponing while the map moves, but never longer than MAX_SYNC_WAIT_MS in all.
    const wait = Math.max(0, Math.min(delay, syncDueSince + MAX_SYNC_WAIT_MS - now))
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncTubesNow()
    }, wait)
  }

  // ---- The flat lines ----

  /**
   * A flight that has a floating tube doesn't also keep its flat line (and click target) on the ground under
   * it. Flights without a tube (not built yet, or flat 2D) keep theirs, and they all come back with 2D.
   */
  function applyLineVisibility() {
    const withTube = tubesWanted() && layer ? new Set(layer.tubeIds()) : new Set<string>()
    for (const flight of deps.getData().flights) {
      const visibility = withTube.has(flight._id) ? 'none' : 'visible'
      for (const prefix of ['flight-line-', 'flight-casing-', 'flight-hit-']) {
        const id = `${prefix}${flight._id}`
        if (!map.getLayer(id)) continue
        if ((map.getLayoutProperty(id, 'visibility') ?? 'visible') !== visibility) {
          map.setLayoutProperty(id, 'visibility', visibility)
        }
      }
    }
  }

  // ---- Replay marker, trail and fades ----

  // Terrain readings jump when tiles load, so the ground glides; the marker's own height is already smooth.
  const groundSmooth = new LowPass(0.45)
  const altitudeSmooth = new LowPass(0.2)
  let lastReplayT = -1
  let visualTs = 0
  /** The marker for the latest frame (the camera and the layer share it, so they never disagree by a frame). */
  let lastMarker: MarkerState | null = null
  /** 0 to 1: how neon the flown part of the path is. */
  let neon = 0
  /** 0 to 1: how visible the marker is. */
  let markerOpacity = 0
  let endFade: {startedAt: number} | null = null
  let fadeRaf: number | null = null

  const groundAt = (lng: number, lat: number) => map.queryTerrainElevation([lng, lat]) ?? 0

  function computeMarker(frame: ReplayFrame, dtSeconds: number): MarkerState {
    const ground = groundSmooth.next(groundAt(frame.lng, frame.lat), dtSeconds)
    if (frame.kind === 'route') {
      const selected = deps.getSelected()
      const activity = selected?.kind === 'track' ? deps.getData().tracks.find((t) => t._id === selected.id)?.activity : undefined
      return {lng: frame.lng, lat: frame.lat, altitude: ground, ground, onGround: true, color: trackColor(activity ?? 'other'), opacity: 1}
    }
    const exaggeration = map.getTerrain()?.exaggeration ?? 1
    const takeoff = groundAt(frame.start.lng, frame.start.lat)
    const raw = Math.max(takeoff + exaggeration * frame.height, groundAt(frame.lng, frame.lat) + GROUND_CLEARANCE_METERS)
    // Smoothed, so the marker doesn't bob as map tiles refine; never under the ground.
    const altitude = Math.max(altitudeSmooth.next(raw, dtSeconds), ground + GROUND_CLEARANCE_METERS)
    return {lng: frame.lng, lat: frame.lat, altitude, ground, onGround: false, color: FLIGHT_PATH_COLOR, opacity: 1}
  }

  // The part of a route already covered, drawn as a bright line over it (a flight does this on its tube instead).
  let trailTrack: ReturnType<ReplayController['getTrack']> = null
  let lastTrail = {progress: -1, neon: -1}

  function removeRouteTrail() {
    if (map.getLayer(TRAIL_LAYER)) map.removeLayer(TRAIL_LAYER)
    if (map.getSource(TRAIL_SOURCE)) map.removeSource(TRAIL_SOURCE)
    trailTrack = null
    lastTrail = {progress: -1, neon: -1}
  }

  /** The route's bright trail colour: neon green for a hike, neon blue for a bike ride. */
  const trailRgb = (): [number, number, number] => {
    const selected = deps.getSelected()
    const activity = selected?.kind === 'track' ? deps.getData().tracks.find((t) => t._id === selected.id)?.activity : undefined
    const value = Number.parseInt(neonTrailColor(activity ?? 'other').slice(1), 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  let trailRgbNow: [number, number, number] = [255, 176, 46]
  const trailColor = (alpha: number) => `rgba(${trailRgbNow[0]},${trailRgbNow[1]},${trailRgbNow[2]},${alpha.toFixed(3)})`

  function updateRouteTrail(frame: ReplayFrame, progress: number, glow: number) {
    const track = replay.getTrack()
    if (frame.kind !== 'route' || !track || glow < 0.01 || progress < 0.0005) {
      if (map.getLayer(TRAIL_LAYER) && map.getLayoutProperty(TRAIL_LAYER, 'visibility') !== 'none') {
        map.setLayoutProperty(TRAIL_LAYER, 'visibility', 'none')
      }
      return
    }
    if (trailTrack !== track) {
      removeRouteTrail()
      trailRgbNow = trailRgb()
      map.addSource(TRAIL_SOURCE, {
        type: 'geojson',
        lineMetrics: true,
        data: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: track.points.map((p) => [p.lng, p.lat])}},
      })
      map.addLayer({
        id: TRAIL_LAYER,
        type: 'line',
        source: TRAIL_SOURCE,
        layout: {'line-join': 'round', 'line-cap': 'round'},
        paint: {'line-width': 5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, trailColor(0), 1, trailColor(0)]},
      })
      trailTrack = track
    }
    if (map.getLayoutProperty(TRAIL_LAYER, 'visibility') === 'none') map.setLayoutProperty(TRAIL_LAYER, 'visibility', 'visible')
    // Only repaint the line when it has moved a visible amount.
    if (Math.abs(progress - lastTrail.progress) < 0.0015 && Math.abs(glow - lastTrail.neon) < 0.02) return
    lastTrail = {progress, neon: glow}
    const on = trailColor(glow)
    const off = trailColor(0)
    map.setPaintProperty(
      TRAIL_LAYER,
      'line-gradient',
      progress >= 0.999
        ? ['interpolate', ['linear'], ['line-progress'], 0, on, 1, on]
        : ['interpolate', ['linear'], ['line-progress'], 0, on, progress, on, Math.min(1, progress + 0.0008), off, 1, off],
    )
  }

  /** Puts the marker and the trail where the replay is, at the current brightness. */
  function applyVisuals(frame: ReplayFrame | null) {
    if (!frame || !frame.visible || !lastMarker) {
      layer?.setMarker(null)
      layer?.setTrail(null, 0)
      if (map.getLayer(TRAIL_LAYER)) map.setLayoutProperty(TRAIL_LAYER, 'visibility', 'none')
      deps.fallbackMarker.hide()
      return
    }
    layer?.setTrail(frame.kind === 'flight' ? frame.distanceFraction : null, neon)
    updateRouteTrail(frame, frame.distanceFraction, neon)
    const visible = markerOpacity > 0.01
    if (layer) {
      layer.setMarker(visible ? {...lastMarker, opacity: markerOpacity} : null)
      deps.fallbackMarker.hide()
    } else if (layerFailed) {
      if (visible) deps.fallbackMarker.show(frame)
      else deps.fallbackMarker.hide()
    }
  }

  const smooth01 = (x: number) => {
    const t = Math.min(1, Math.max(0, x))
    return t * t * (3 - 2 * t)
  }

  /** The replay has finished: the neon cools back to the normal colour, then the marker fades away. */
  function startEndFade() {
    endFade = {startedAt: performance.now()}
    if (fadeRaf !== null) return
    const step = () => {
      fadeRaf = null
      if (!endFade || disposed) return
      const seconds = (performance.now() - endFade.startedAt) / 1000
      neon = 1 - smooth01(seconds / NEON_FADE_SECONDS)
      markerOpacity = 1 - smooth01((seconds - MARKER_FADE_DELAY_SECONDS) / MARKER_FADE_SECONDS)
      applyVisuals(replay.getFrame())
      if (seconds < Math.max(NEON_FADE_SECONDS, MARKER_FADE_DELAY_SECONDS + MARKER_FADE_SECONDS) + 0.05) {
        fadeRaf = requestAnimationFrame(step)
      }
    }
    fadeRaf = requestAnimationFrame(step)
  }

  // ---- Follow camera ----

  const follower = new CameraFollower()
  let following = false
  let clampedOff = false
  let followRaf: number | null = null
  let followTs = 0
  /** The camera is flying in to the start (or flying back): it isn't being steered frame by frame. */
  let introActive = false
  let introPending = false
  let wasPlaying = false

  const currentPose = (): CameraPose => {
    const c = map.getCenter()
    return {lng: c.lng, lat: c.lat, elevation: map.getCenterElevation(), bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom()}
  }

  /**
   * How much higher the camera must look from (meters) so that neither the point it looks at nor the camera behind
   * it is under the ground. The camera sits back and above the point, so a flight skimming a hillside would
   * otherwise put it under the slope; the map would then shove it up by cutting the tilt in one go. Raising the
   * look-at height instead lifts the whole camera cleanly.
   */
  function cameraLift(pose: CameraPose): number {
    const latitude = (pose.lat * Math.PI) / 180
    const metersPerPixel = (78271.517 * Math.cos(latitude)) / 2 ** pose.zoom
    const distance = 1.5 * map.getContainer().clientHeight * metersPerPixel // camera to the point it looks at
    const tilt = (pose.pitch * Math.PI) / 180
    const back = distance * Math.sin(tilt)
    const rise = distance * Math.cos(tilt)
    const away = ((pose.bearing + 180) * Math.PI) / 180
    const metersPerDegree = 111_320
    let lift = 0
    // 0 is the point being looked at; 1 is the camera itself.
    for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
      const lat = pose.lat + (back * fraction * Math.cos(away)) / metersPerDegree
      const lng = pose.lng + (back * fraction * Math.sin(away)) / (metersPerDegree * Math.cos(latitude))
      const ground = map.queryTerrainElevation([lng, lat]) ?? 0
      const clearance = fraction === 0 ? 8 : CAMERA_CLEARANCE_METERS
      lift = Math.max(lift, ground + clearance - (pose.elevation + rise * fraction))
    }
    return lift
  }

  function targetPose(frame: ReplayFrame): CameraPose {
    const marker = lastMarker ?? computeMarker(frame, 1 / 60)
    const pose: CameraPose = {
      lng: frame.lng,
      lat: frame.lat,
      elevation: frame.kind === 'flight' ? marker.altitude : marker.ground,
      bearing: frame.course,
      pitch: FOLLOW_PITCH,
      zoom: FOLLOW_ZOOM[frame.kind],
    }
    // Aim a little higher where the ground rises behind the marker, so the camera's smoothing lifts it early.
    return {...pose, elevation: pose.elevation + cameraLift(pose)}
  }

  /** One step of the follow camera; returns where it is heading. Runs in the same frame as the marker moves. */
  function stepFollow(now: number): CameraPose | null {
    const frame = replay.getFrame()
    if (!following || !frame || disposed) return null
    // Switching 3D off hands the camera back.
    if (!deps.isThreeD()) {
      replay.releaseCamera()
      stopFollow()
      return null
    }
    const dt = followTs ? Math.min(0.25, (now - followTs) / 1000) : 1 / 60
    followTs = now
    const target = targetPose(frame)
    const stepped = follower.step(dt, target)
    // Whatever the smoothing says, the camera is never allowed under the ground (a terrain tile that loads late
    // can leave the look-at point underground for a few frames); it just rises, and the smoothing carries on from there.
    const lift = cameraLift(stepped)
    const pose = lift > 0 ? {...stepped, elevation: stepped.elevation + lift} : stepped
    if (lift > 0) follower.pose = pose
    map.jumpTo({center: [pose.lng, pose.lat], elevation: pose.elevation, bearing: pose.bearing, pitch: pose.pitch, zoom: pose.zoom})
    return target
  }

  /** While paused (after Re-center, or a scrub) the camera still needs a few frames to glide to the marker. */
  function followLoop(now: number) {
    followRaf = null
    if (!following || replay.getState().playing) return
    const target = stepFollow(now)
    if (target && !follower.isSettled(target)) followRaf = requestAnimationFrame(followLoop)
  }

  function startFollow() {
    if (following) return
    following = true
    follower.reset(currentPose())
    // A flight's camera looks at the aircraft, not the ground under it.
    if (!clampedOff) {
      map.setCenterClampedToGround(false)
      clampedOff = true
    }
    followTs = 0
    if (!replay.getState().playing) followRaf = requestAnimationFrame(followLoop)
  }

  function stopFollow(restoreClamp = true) {
    following = false
    if (followRaf !== null) cancelAnimationFrame(followRaf)
    followRaf = null
    if (restoreClamp && clampedOff) {
      map.setCenterClampedToGround(true)
      clampedOff = false
    }
  }

  /**
   * A gliding flight to a camera pose (used to fly in to the start, and to fly back at the end). Flying in aims at
   * the ground under the start (the terrain may still be loading, so a height would be a guess); flying back
   * returns to the exact height the camera had.
   */
  function flyToPose(pose: CameraPose, durationMs: number, exactHeight: boolean, done: () => void) {
    if (exactHeight && !clampedOff) {
      map.setCenterClampedToGround(false)
      clampedOff = true
    }
    map.once('moveend', done)
    map.flyTo({
      center: [pose.lng, pose.lat],
      ...(exactHeight ? {elevation: pose.elevation} : {}),
      bearing: pose.bearing,
      pitch: pose.pitch,
      zoom: pose.zoom,
      duration: durationMs,
      curve: 1.25,
      essential: true,
    })
  }

  const needsIntro = (target: CameraPose) => {
    const c = map.getCenter()
    return (
      Math.abs(map.getZoom() - target.zoom) > 1.2 ||
      distanceMeters(c.lng, c.lat, target.lng, target.lat) > 400 ||
      Math.abs(map.getPitch() - target.pitch) > 15
    )
  }

  function startIntro(target: CameraPose) {
    const c = map.getCenter()
    const km = distanceMeters(c.lng, c.lat, target.lng, target.lat) / 1000
    const ms = Math.min(3400, Math.max(1900, 1500 + Math.abs(map.getZoom() - target.zoom) * 180 + Math.min(km, 20) * 25))
    introActive = true
    replay.hold(ms + 200)
    flyToPose(target, ms, false, () => {
      introActive = false
      const state = replay.getState()
      if (state.visible && state.following && !state.reducedMotion && deps.isThreeD() && !returned) startFollow()
    })
  }

  function cancelIntro() {
    if (!introActive) return
    introActive = false
    replay.hold(0)
    map.stop()
  }

  // ---- Coming back ----

  /** Where the camera (and which dimension) was when Play was pressed, to put it back when the replay ends. */
  let returnPoint: {pose: CameraPose; threeD: boolean} | null = null
  /** The camera has been sent back: don't follow the marker again until Play (or a scrub from a fresh start). */
  let returned = false

  function returnToStart() {
    const point = returnPoint
    returnPoint = null
    if (!point || disposed) return
    returned = true
    const state = replay.getState()
    // Only take the camera back if it was ours (a person who took over keeps what they set up).
    if (!state.following && !state.reducedMotion) return
    const turnOff = () => {
      if (!point.threeD && deps.isThreeD()) deps.requestThreeD(false)
    }
    if (state.reducedMotion || !following) {
      turnOff()
      return
    }
    // Glide back, still looking from the aircraft's height so there's no jump, then let the ground take over.
    stopFollow(false)
    flyToPose(point.pose, RETURN_DURATION_MS, true, () => {
      if (clampedOff) {
        map.setCenterClampedToGround(true)
        clampedOff = false
      }
      turnOff()
    })
  }

  function evaluateFollow() {
    const state = replay.getState()
    const frame = replay.getFrame()
    const should = Boolean(frame) && state.visible && state.following && !state.reducedMotion && deps.isThreeD() && !returned
    if (!should) {
      cancelIntro()
      // Started from 2D: 3D takes a moment to switch on, so the fly-in waits for it.
      if (!state.visible || !state.following || state.reducedMotion) introPending = false
      if (following) stopFollow()
      return
    }
    if (introActive) return
    if (introPending && frame) {
      introPending = false
      const target = targetPose(frame)
      if (needsIntro(target)) {
        startIntro(target)
        return
      }
      replay.hold(0)
    }
    if (!following) startFollow()
    else if (followRaf === null && !state.playing) followRaf = requestAnimationFrame(followLoop)
  }

  // ---- Wiring ----

  const onFrame = (frame: ReplayFrame) => {
    const now = performance.now()
    const dt = visualTs ? Math.min(0.25, (now - visualTs) / 1000) : 1 / 60
    visualTs = now

    // Pressing Play: remember how things were (this runs inside the click, before 3D switches on or the camera moves),
    // and give the camera time to fly in before the marker sets off.
    if (frame.playing && !wasPlaying) {
      returned = false
      if (!returnPoint) returnPoint = {pose: currentPose(), threeD: deps.isThreeD()}
      const state = replay.getState()
      if (state.following && !state.reducedMotion) {
        introPending = true
        replay.hold(INTRO_WAIT_MS)
      }
    }
    wasPlaying = frame.playing

    if (!frame.visible) {
      neon = 0
      markerOpacity = 0
      endFade = null
      lastMarker = null
      groundSmooth.reset()
      altitudeSmooth.reset()
      lastReplayT = -1
      applyVisuals(null)
      removeRouteTrail()
      evaluateFollow()
      return
    }

    // The replay jumped somewhere else (a scrub): let the readings go straight there instead of gliding from far away.
    if (lastReplayT >= 0 && Math.abs(frame.t - lastReplayT) > frame.speed * 0.5 + 1) {
      groundSmooth.reset()
      altitudeSmooth.reset()
    }
    lastReplayT = frame.t

    // Playing again, or scrubbing back from the end, cancels the fade-out.
    if (endFade && frame.fraction < 0.995) endFade = null
    if (!endFade) {
      neon = easeToward(neon, 1, dt, 0.12)
      markerOpacity = easeToward(markerOpacity, 1, dt, 0.1)
    }
    lastMarker = computeMarker(frame, dt)

    if (!layer && !layerFailed) {
      // The 3D layer loads on first need: draw the marker as soon as it's there.
      void ensureLayer().then(() => applyVisuals(replay.getFrame()))
    }
    applyVisuals(frame)

    // The camera takes its step in the same frame as the marker, so they never drift apart.
    evaluateFollow()
    if (following && frame.playing && !introActive) stepFollow(now)
  }

  const unsubscribeFrames = replay.subscribeFrames(onFrame)
  const unsubscribeState = replay.subscribeState(() => {
    // Closing the card or opening another flight forgets where to come back to.
    if (!replay.getState().visible && !replay.getState().playing) {
      returnPoint = null
      returned = false
    }
    evaluateFollow()
  })
  const unsubscribeEnded = replay.subscribeEnded(() => {
    startEndFade()
    returnToStart()
  })

  // Any hand on the camera takes it over. These are real input events on the map (MapLibre's own gesture events
  // don't all say where they came from, and wheel zoom doesn't), so touch, mouse, wheel and keys all count.
  const container = map.getContainer()
  const TAKEOVER_EVENTS = ['pointerdown', 'wheel', 'dblclick', 'keydown'] as const
  const takeOver = () => {
    if (following || introActive) replay.releaseCamera()
  }
  for (const type of TAKEOVER_EVENTS) container.addEventListener(type, takeOver, {capture: true, passive: true})
  const onTerrainIdle = () => {
    layer?.refreshTerrain()
  }
  const onViewChange = () => scheduleSync()
  map.on('moveend', onViewChange)
  map.on('idle', onTerrainIdle)

  return {
    sync: () => {
      // The flat lines may have just been redrawn (a filter changed): hide the ones that have tubes right away.
      applyLineVisibility()
      scheduleSync(0)
    },
    pickFlight: (x, y, maxPx) => (layer && tubesWanted() ? layer.pick(x, y, maxPx) : null),
    dispose: () => {
      disposed = true
      if (syncTimer) clearTimeout(syncTimer)
      if (fadeRaf !== null) cancelAnimationFrame(fadeRaf)
      cancelIntro()
      stopFollow()
      removeRouteTrail()
      unsubscribeFrames()
      unsubscribeState()
      unsubscribeEnded()
      for (const type of TAKEOVER_EVENTS) container.removeEventListener(type, takeOver, {capture: true})
      map.off('moveend', onViewChange)
      map.off('idle', onTerrainIdle)
      if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id)
      layer = null
      returnPoint = null
    },
  }
}
