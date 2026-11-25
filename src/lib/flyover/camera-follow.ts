/** The signed shortest turn from one compass bearing to another, in -180..180 degrees. */
export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/** Eases a value toward its target. `tau` is how long (seconds) it takes to close about two thirds of the gap. */
export function easeToward(current: number, target: number, dtSeconds: number, tau: number): number {
  if (tau <= 0 || dtSeconds <= 0) return dtSeconds <= 0 ? current : target
  return current + (target - current) * (1 - Math.exp(-dtSeconds / tau))
}

/** Eases a bearing toward its target the short way round (never spinning the long way past north). */
export function easeBearing(current: number, target: number, dtSeconds: number, tau: number): number {
  const next = current + shortestAngleDelta(current, target) * (1 - Math.exp(-Math.max(0, dtSeconds) / tau))
  return ((next % 360) + 360) % 360
}

/**
 * The follow camera: close behind and a little above the marker, looking along its path. At this tilt the camera
 * sits about 200 m back (a flight) or 230 m (a route) at mid latitudes; each zoom level halves that distance.
 */
export const FOLLOW_PITCH = 66
export const FOLLOW_ZOOM: Record<'flight' | 'route', number> = {flight: 18.4, route: 18.2}

export type CameraPose = {
  lng: number
  lat: number
  /** Meters above sea level, as drawn, of the point the camera looks at. */
  elevation: number
  bearing: number
  pitch: number
  zoom: number
}

/**
 * Moves a value toward a target like a critically damped spring: it starts from rest (no sudden snap), speeds up,
 * and settles without overshooting. `smoothTime` is roughly how long it takes to get there. Returns the new
 * value and velocity. (The same smoothing games use for follow cameras.)
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dtSeconds: number,
): [value: number, velocity: number] {
  if (dtSeconds <= 0) return [current, velocity]
  const omega = 2 / Math.max(0.0001, smoothTime)
  const x = omega * dtSeconds
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity + omega * change) * dtSeconds
  const nextVelocity = (velocity - omega * temp) * decay
  return [target + (change + temp) * decay, nextVelocity]
}

/** The same for a compass bearing, turning the short way round. */
export function smoothDampAngle(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dtSeconds: number,
): [value: number, velocity: number] {
  const [value, nextVelocity] = smoothDamp(current, current + shortestAngleDelta(current, target), velocity, smoothTime, dtSeconds)
  return [((value % 360) + 360) % 360, nextVelocity]
}

/** How long (seconds) each part of the camera takes to catch up. Position is quick; zoom and tilt are lazier. */
const SMOOTH_TIME = {position: 0.28, elevation: 0.7, bearing: 0.9, pitch: 1.0, zoom: 1.3}

const SETTLED = {position: 2e-7, elevation: 0.2, bearing: 0.1, pitch: 0.1, zoom: 0.01}

/**
 * Glides a camera toward where it should be. It starts from rest wherever the camera is, so starting a replay or
 * pressing re-center eases in instead of snapping, and a moving target is followed without jitter.
 */
export class CameraFollower {
  pose: CameraPose | null = null
  private velocity = {lng: 0, lat: 0, elevation: 0, bearing: 0, pitch: 0, zoom: 0}

  reset(pose: CameraPose) {
    this.pose = {...pose}
    this.velocity = {lng: 0, lat: 0, elevation: 0, bearing: 0, pitch: 0, zoom: 0}
  }

  step(dtSeconds: number, target: CameraPose): CameraPose {
    const from = this.pose ?? target
    const v = this.velocity
    const [lng, vLng] = smoothDamp(from.lng, target.lng, v.lng, SMOOTH_TIME.position, dtSeconds)
    const [lat, vLat] = smoothDamp(from.lat, target.lat, v.lat, SMOOTH_TIME.position, dtSeconds)
    const [elevation, vElevation] = smoothDamp(from.elevation, target.elevation, v.elevation, SMOOTH_TIME.elevation, dtSeconds)
    const [bearing, vBearing] = smoothDampAngle(from.bearing, target.bearing, v.bearing, SMOOTH_TIME.bearing, dtSeconds)
    const [pitch, vPitch] = smoothDamp(from.pitch, target.pitch, v.pitch, SMOOTH_TIME.pitch, dtSeconds)
    const [zoom, vZoom] = smoothDamp(from.zoom, target.zoom, v.zoom, SMOOTH_TIME.zoom, dtSeconds)
    this.velocity = {lng: vLng, lat: vLat, elevation: vElevation, bearing: vBearing, pitch: vPitch, zoom: vZoom}
    this.pose = {lng, lat, elevation, bearing, pitch, zoom}
    return this.pose
  }

  /** True once the camera has caught up with the target and stopped moving (so a paused replay can stop animating). */
  isSettled(target: CameraPose): boolean {
    const p = this.pose
    if (!p) return false
    const v = this.velocity
    return (
      Math.abs(p.lng - target.lng) < SETTLED.position &&
      Math.abs(p.lat - target.lat) < SETTLED.position &&
      Math.abs(p.elevation - target.elevation) < SETTLED.elevation &&
      Math.abs(shortestAngleDelta(p.bearing, target.bearing)) < SETTLED.bearing &&
      Math.abs(p.pitch - target.pitch) < SETTLED.pitch &&
      Math.abs(p.zoom - target.zoom) < SETTLED.zoom &&
      Math.abs(v.lng) < 1e-6 &&
      Math.abs(v.lat) < 1e-6 &&
      Math.abs(v.zoom) < 0.05 &&
      Math.abs(v.pitch) < 0.5 &&
      Math.abs(v.bearing) < 0.5
    )
  }
}
