export type Vec3 = {x: number; y: number; z: number}

/** A thin tube as flat arrays, ready for the GPU. Each ring vertex stores its centre and a unit direction outward. */
export type TubeBuffers = {
  /** x,y,z of the centre line, repeated for every vertex of the ring. */
  center: Float32Array
  /** Unit vector from the centre line out to the surface; the radius is applied on the GPU. */
  offset: Float32Array
  index: Uint32Array
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z})
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
const scale = (a: Vec3, k: number): Vec3 => ({x: a.x * k, y: a.y * k, z: a.z * k})
function normalize(a: Vec3, fallback: Vec3): Vec3 {
  const len = length(a)
  return len > 1e-9 ? scale(a, 1 / len) : fallback
}

/**
 * Sweeps a ring along a path. The ring is turned with the path without twisting (each ring starts from the
 * previous one), and the geometry is deliberately low: `radialSegments` sides, one ring per path point.
 */
export function buildTube(points: Vec3[], radialSegments = 5): TubeBuffers {
  const n = points.length
  const sides = Math.max(3, Math.floor(radialSegments))
  if (n < 2) return {center: new Float32Array(0), offset: new Float32Array(0), index: new Uint32Array(0)}

  const center = new Float32Array(n * sides * 3)
  const offset = new Float32Array(n * sides * 3)
  const index = new Uint32Array((n - 1) * sides * 6)

  let tangent: Vec3 = {x: 0, y: 0, z: 1}
  let normal: Vec3 | null = null
  for (let i = 0; i < n; i += 1) {
    const before = points[Math.max(0, i - 1)]!
    const after = points[Math.min(n - 1, i + 1)]!
    tangent = normalize(sub(after, before), tangent)
    if (!normal) {
      // Start from whichever world axis is least aligned with the path.
      const reference: Vec3 = Math.abs(tangent.z) > 0.9 ? {x: 1, y: 0, z: 0} : {x: 0, y: 0, z: 1}
      normal = normalize(cross(tangent, reference), {x: 1, y: 0, z: 0})
    } else {
      normal = normalize(sub(normal, scale(tangent, dot(normal, tangent))), normal)
    }
    const binormal = cross(tangent, normal)
    const p = points[i]!
    for (let k = 0; k < sides; k += 1) {
      const angle = (k / sides) * Math.PI * 2
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const at = (i * sides + k) * 3
      center[at] = p.x
      center[at + 1] = p.y
      center[at + 2] = p.z
      offset[at] = normal.x * c + binormal.x * s
      offset[at + 1] = normal.y * c + binormal.y * s
      offset[at + 2] = normal.z * c + binormal.z * s
    }
  }

  let w = 0
  for (let i = 0; i < n - 1; i += 1) {
    for (let k = 0; k < sides; k += 1) {
      const a = i * sides + k
      const b = i * sides + ((k + 1) % sides)
      const c = (i + 1) * sides + k
      const d = (i + 1) * sides + ((k + 1) % sides)
      index[w++] = a
      index[w++] = b
      index[w++] = c
      index[w++] = b
      index[w++] = d
      index[w++] = c
    }
  }
  return {center, offset, index}
}

/** Joins several tubes into one set of buffers (one draw call), keeping each tube's indexes pointing at its own vertices. */
export function mergeTubes(tubes: TubeBuffers[]): TubeBuffers {
  const vertexFloats = tubes.reduce((sum, t) => sum + t.center.length, 0)
  const indexCount = tubes.reduce((sum, t) => sum + t.index.length, 0)
  const center = new Float32Array(vertexFloats)
  const offset = new Float32Array(vertexFloats)
  const index = new Uint32Array(indexCount)
  let floatAt = 0
  let indexAt = 0
  for (const tube of tubes) {
    const base = floatAt / 3
    center.set(tube.center, floatAt)
    offset.set(tube.offset, floatAt)
    for (let i = 0; i < tube.index.length; i += 1) index[indexAt + i] = tube.index[i]! + base
    floatAt += tube.center.length
    indexAt += tube.index.length
  }
  return {center, offset, index}
}
