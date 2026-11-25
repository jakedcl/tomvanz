/** Line color from the track's activity field in Studio. */
export function trackColor(activity: 'bike' | 'hike' | 'other'): string {
  if (activity === 'hike') return '#2d6a4f'
  if (activity === 'bike') return '#1874a5'
  return '#9c6644'
}

/**
 * The bright "already covered" colour of a route during a replay: neon green for a hike, neon blue for a bike ride
 * (the same families as their lines), a neon amber for anything else. Flights glow neon orange.
 */
export function neonTrailColor(activity: 'bike' | 'hike' | 'other'): string {
  if (activity === 'hike') return '#3dff74'
  if (activity === 'bike') return '#2fa8ff'
  return '#ffb02e'
}
