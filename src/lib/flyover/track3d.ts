/** One point of a flight: longitude, latitude, and height above the takeoff point in meters. */
export type Point3 = [lng: number, lat: number, height: number]

const METERS_PER_DEG_LAT = 111_320

/** Local flat-earth meters around `origin`, good enough for the few km a flight covers. */
function toMeters(origin: Point3, p: Point3): [number, number, number] {
  const cosLat = Math.cos((origin[1] * Math.PI) / 180)
  return [(p[0] - origin[0]) * METERS_PER_DEG_LAT * cosLat, (p[1] - origin[1]) * METERS_PER_DEG_LAT, p[2]]
}

function distanceToSegment(p: [number, number, number], a: [number, number, number], b: [number, number, number]) {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const len2 = abx * abx + aby * aby + abz * abz
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby), p[2] - (a[2] + t * abz))
}

/** Douglas–Peucker in 3D (a climb counts as much as a turn). Returns the indexes to keep, ascending. */
function keepIndexes(local: [number, number, number][], tolerance: number): number[] {
  const last = local.length - 1
  const keep = new Uint8Array(local.length)
  keep[0] = 1
  keep[last] = 1
  const stack: [number, number][] = [[0, last]]
  while (stack.length > 0) {
    const [from, to] = stack.pop()!
    let worst = 0
    let worstIndex = -1
    for (let i = from + 1; i < to; i += 1) {
      const d = distanceToSegment(local[i]!, local[from]!, local[to]!)
      if (d > worst) {
        worst = d
        worstIndex = i
      }
    }
    if (worstIndex !== -1 && worst > tolerance) {
      keep[worstIndex] = 1
      stack.push([from, worstIndex], [worstIndex, to])
    }
  }
  const out: number[] = []
  for (let i = 0; i < keep.length; i += 1) if (keep[i]) out.push(i)
  return out
}

const round = (value: number, decimals: number) => {
  const k = 10 ** decimals
  return Math.round(value * k) / k
}

/**
 * Thins a flight to the points that matter for drawing it: drops repeats, runs Douglas–Peucker in 3D, and
 * loosens the tolerance until there are at most `maxPoints`. The first and last points always stay.
 */
export function simplifyTrack3D(points: Point3[], toleranceMeters = 3, maxPoints = 200): Point3[] {
  const clean = points.filter((p, i) => {
    const prev = points[i - 1]
    return i === 0 || !prev || p[0] !== prev[0] || p[1] !== prev[1] || p[2] !== prev[2]
  })
  if (clean.length <= 2) return clean.map((p) => [round(p[0], 5), round(p[1], 5), round(p[2], 1)])

  const local = clean.map((p) => toMeters(clean[0]!, p))
  let tolerance = toleranceMeters
  let indexes = keepIndexes(local, tolerance)
  while (indexes.length > Math.max(2, maxPoints) && tolerance < 2000) {
    tolerance *= 1.5
    indexes = keepIndexes(local, tolerance)
  }
  return indexes.map((i) => {
    const p = clean[i]!
    return [round(p[0], 5), round(p[1], 5), round(p[2], 1)]
  })
}

/** Heights for a flight that has no log: a flat, modest cruise (its highest point, capped) so it still floats. */
export function fallbackHeight(maxHeightMeters: number | undefined): number {
  const max = Number.isFinite(maxHeightMeters) && (maxHeightMeters ?? 0) > 0 ? (maxHeightMeters as number) : 60
  return Math.min(120, Math.max(20, max * 0.6))
}
