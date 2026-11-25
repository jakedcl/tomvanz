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

/** The follow camera: behind and above the marker, looking along its path. */
export const FOLLOW_PITCH = 66
export const FOLLOW_ZOOM: Record<'flight' | 'route', number> = {flight: 16.2, route: 15.6}
/** How quickly the camera turns to the direction of travel (seconds). */
export const FOLLOW_BEARING_TAU = 1.1
export const FOLLOW_POSITION_TAU = 0.35

export type CameraPose = {
  lng: number
  lat: number
  /** Meters above sea level, as drawn, of the point the camera looks at. */
  elevation: number
  bearing: number
  pitch: number
  zoom: number
}

const SETTLED = {position: 2e-7, elevation: 0.2, bearing: 0.1, pitch: 0.1, zoom: 0.01}

/**
 * Moves a camera toward where it should be, a little each frame, so it glides instead of snapping. The same
 * easing is used wherever the camera starts, so starting a replay (or pressing re-center) glides in too.
 */
export class CameraFollower {
  pose: CameraPose | null = null

  reset(pose: CameraPose) {
    this.pose = {...pose}
  }

  step(dtSeconds: number, target: CameraPose): CameraPose {
    const from = this.pose ?? target
    this.pose = {
      lng: easeToward(from.lng, target.lng, dtSeconds, FOLLOW_POSITION_TAU),
      lat: easeToward(from.lat, target.lat, dtSeconds, FOLLOW_POSITION_TAU),
      elevation: easeToward(from.elevation, target.elevation, dtSeconds, 0.5),
      bearing: easeBearing(from.bearing, target.bearing, dtSeconds, FOLLOW_BEARING_TAU),
      pitch: easeToward(from.pitch, target.pitch, dtSeconds, 0.8),
      zoom: easeToward(from.zoom, target.zoom, dtSeconds, 0.8),
    }
    return this.pose
  }

  /** True once the camera has caught up with the target (so a paused replay can stop animating). */
  isSettled(target: CameraPose): boolean {
    const p = this.pose
    if (!p) return false
    return (
      Math.abs(p.lng - target.lng) < SETTLED.position &&
      Math.abs(p.lat - target.lat) < SETTLED.position &&
      Math.abs(p.elevation - target.elevation) < SETTLED.elevation &&
      Math.abs(shortestAngleDelta(p.bearing, target.bearing)) < SETTLED.bearing &&
      Math.abs(p.pitch - target.pitch) < SETTLED.pitch &&
      Math.abs(p.zoom - target.zoom) < SETTLED.zoom
    )
  }
}
