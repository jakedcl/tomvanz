import type {Map as MapLibreMap} from 'maplibre-gl'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {trackColor} from '@/lib/track-color'
import {lineCoordinates, type FlightDoc, type MapData, type SelectedItem} from '@/lib/sanity/types'
import {GROUND_CLEARANCE_METERS} from '@/lib/flyover/altitude'
import {CameraFollower, FOLLOW_PITCH, FOLLOW_ZOOM, type CameraPose} from '@/lib/flyover/camera-follow'
import {loadFlightTracks} from '@/lib/flyover/flight-tracks-client'
import type {ReplayController, ReplayFrame} from '@/lib/flyover/replay-controller'
import {fallbackHeight, type Point3} from '@/lib/flyover/track3d'
import type {FlyoverLayer, MarkerState, TubeFlight} from './flyover-layer'

/** Flights only become tubes once the map is tilted past this many degrees. */
export const TUBE_MIN_PITCH = 20
/** Most tubes built at once; the nearest to the middle of the view win. */
const MAX_TUBES = 60
/** How far past the edge of the screen (as a share of its size) flights still get tubes, so panning feels solid. */
const VIEW_PADDING = 0.25

export type FlyoverDeps = {
  getData: () => MapData
  getSelected: () => SelectedItem | null
  isThreeD: () => boolean
  replay: ReplayController
  /** Draws the replay marker with plain DOM, if the 3D layer can't be used (no WebGL2, failed to load). */
  fallbackMarker: {show: (frame: ReplayFrame) => void; hide: () => void}
}

export type FlyoverHandle = {
  /** Call when the flights shown, the selection, or 3D mode changed. */
  sync: () => void
  /** The flight whose floating tube is under a screen point, if tubes are showing. */
  pickFlight: (x: number, y: number) => string | null
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
  }

  const scheduleSync = (delay = 120) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => void syncTubesNow(), delay)
  }

  // ---- Replay marker ----

  const groundAt = (lng: number, lat: number) => map.queryTerrainElevation([lng, lat]) ?? 0

  function markerFor(frame: ReplayFrame): MarkerState {
    const ground = groundAt(frame.lng, frame.lat)
    if (frame.kind === 'route') {
      const selected = deps.getSelected()
      const activity = selected?.kind === 'track' ? deps.getData().tracks.find((t) => t._id === selected.id)?.activity : undefined
      return {lng: frame.lng, lat: frame.lat, altitude: ground, ground, onGround: true, color: trackColor(activity ?? 'other')}
    }
    const exaggeration = map.getTerrain()?.exaggeration ?? 1
    const takeoff = groundAt(frame.start.lng, frame.start.lat)
    const altitude = Math.max(takeoff + exaggeration * frame.height, ground + GROUND_CLEARANCE_METERS)
    return {lng: frame.lng, lat: frame.lat, altitude, ground, onGround: false, color: FLIGHT_PATH_COLOR}
  }

  // ---- Follow camera ----

  const follower = new CameraFollower()
  let following = false
  let clampedOff = false
  let followRaf: number | null = null
  let lastTs = 0

  const currentPose = (): CameraPose => {
    const c = map.getCenter()
    return {lng: c.lng, lat: c.lat, elevation: map.getCenterElevation(), bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom()}
  }

  function targetPose(frame: ReplayFrame): CameraPose {
    const marker = markerFor(frame)
    return {
      lng: frame.lng,
      lat: frame.lat,
      elevation: frame.kind === 'flight' ? marker.altitude : marker.ground,
      bearing: frame.course,
      pitch: FOLLOW_PITCH,
      zoom: FOLLOW_ZOOM[frame.kind],
    }
  }

  function followStep(ts: number) {
    followRaf = null
    const frame = replay.getFrame()
    if (!following || !frame || disposed) return
    // Switching 3D off hands the camera back.
    if (!deps.isThreeD()) {
      replay.releaseCamera()
      stopFollow()
      return
    }
    const dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 1 / 60
    lastTs = ts
    const target = targetPose(frame)
    const pose = follower.step(dt, target)
    map.jumpTo({center: [pose.lng, pose.lat], elevation: pose.elevation, bearing: pose.bearing, pitch: pose.pitch, zoom: pose.zoom})
    if (replay.getState().playing || !follower.isSettled(target)) followRaf = requestAnimationFrame(followStep)
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
    lastTs = 0
    followRaf = requestAnimationFrame(followStep)
  }

  function stopFollow() {
    following = false
    if (followRaf !== null) cancelAnimationFrame(followRaf)
    followRaf = null
    if (clampedOff) {
      map.setCenterClampedToGround(true)
      clampedOff = false
    }
  }

  function evaluateFollow() {
    const state = replay.getState()
    const should = state.visible && state.following && !state.reducedMotion && deps.isThreeD()
    if (should) {
      if (!following) startFollow()
      else if (followRaf === null) followRaf = requestAnimationFrame(followStep)
    } else if (following) {
      stopFollow()
    }
  }

  // ---- Wiring ----

  const onFrame = (frame: ReplayFrame) => {
    if (!frame.visible) {
      layer?.setMarker(null)
      deps.fallbackMarker.hide()
      evaluateFollow()
      return
    }
    if (layer) {
      layer.setMarker(markerFor(frame))
      deps.fallbackMarker.hide()
    } else if (layerFailed) {
      deps.fallbackMarker.show(frame)
    } else {
      void ensureLayer().then((active) => {
        const latest = replay.getFrame()
        if (!latest?.visible) return
        if (active) active.setMarker(markerFor(latest))
        else deps.fallbackMarker.show(latest)
      })
    }
    evaluateFollow()
  }

  const unsubscribeFrames = replay.subscribeFrames(onFrame)
  const unsubscribeState = replay.subscribeState(evaluateFollow)

  // Any hand on the camera takes it over. These are real input events on the map (MapLibre's own gesture events
  // don't all say where they came from, and wheel zoom doesn't), so touch, mouse, wheel and keys all count.
  const container = map.getContainer()
  const TAKEOVER_EVENTS = ['pointerdown', 'wheel', 'dblclick', 'keydown'] as const
  const takeOver = () => {
    if (following) replay.releaseCamera()
  }
  for (const type of TAKEOVER_EVENTS) container.addEventListener(type, takeOver, {capture: true, passive: true})
  const onTerrainIdle = () => {
    layer?.refreshTerrain()
  }
  const onViewChange = () => scheduleSync()
  map.on('moveend', onViewChange)
  map.on('idle', onTerrainIdle)

  return {
    sync: () => scheduleSync(0),
    pickFlight: (x, y) => (layer && tubesWanted() ? layer.pick(x, y) : null),
    dispose: () => {
      disposed = true
      if (syncTimer) clearTimeout(syncTimer)
      stopFollow()
      unsubscribeFrames()
      unsubscribeState()
      for (const type of TAKEOVER_EVENTS) container.removeEventListener(type, takeOver, {capture: true})
      map.off('moveend', onViewChange)
      map.off('idle', onTerrainIdle)
      if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id)
      layer = null
    },
  }
}
