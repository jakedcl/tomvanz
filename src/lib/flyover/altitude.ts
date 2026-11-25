import type {Point3} from './track3d'

/** A tube or marker never goes lower than this above the ground under it (meters, as drawn). */
export const GROUND_CLEARANCE_METERS = 2

/**
 * How high each point of a flight is drawn, in the same exaggerated meters the terrain is drawn in.
 *
 *   altitude = terrain at takeoff + exaggeration x height above takeoff
 *
 * Height is scaled with the terrain so a flight keeps the same clearance over the (exaggerated) hills as in
 * life. Then it is lifted if it would dip under the ground at that point, so a tube never sinks into a hillside.
 * `terrainAt` returns the drawn terrain height at a point, or null if that isn't known yet (then no lift).
 */
export function absoluteAltitudes(
  points: Point3[],
  options: {
    takeoffElevation: number
    exaggeration: number
    terrainAt: (lng: number, lat: number) => number | null
  },
): number[] {
  const {takeoffElevation, exaggeration, terrainAt} = options
  return points.map(([lng, lat, height]) => {
    const flat = takeoffElevation + exaggeration * Math.max(0, height)
    const ground = terrainAt(lng, lat)
    return ground == null ? flat : Math.max(flat, ground + GROUND_CLEARANCE_METERS)
  })
}
