import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Matrix4,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import {MercatorCoordinate} from 'maplibre-gl'
import type {CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap} from 'maplibre-gl'
import {absoluteAltitudes} from '@/lib/flyover/altitude'
import {buildTube, mergeTubes, type TubeBuffers, type Vec3} from '@/lib/flyover/tube-geometry'
import type {Point3} from '@/lib/flyover/track3d'

/**
 * One three.js scene drawn inside MapLibre's own WebGL context (so terrain hides what's behind it): the flight
 * tubes floating at their real altitude, and the replay marker. three.js is only loaded when this file is.
 *
 * Positions are in meters from a local origin (one per ~50 km cell) and the matrix puts them on the map, so
 * the numbers stay small enough for the GPU to keep sub-meter precision across a whole country of flights.
 */

export type TubeFlight = {id: string; points: Point3[]}

export type MarkerState = {
  lng: number
  lat: number
  /** Where the marker is, in meters as the terrain is drawn. */
  altitude: number
  /** The terrain under it. */
  ground: number
  /** Sit on the ground (a route) rather than float (a flight). */
  onGround: boolean
  color: string
  /** 1 fully there, 0 gone (it fades away when a replay ends). */
  opacity: number
}

type Cell = {
  origin: {x: number; y: number; s: number}
  scene: Scene
  meshes: Mesh[]
  baseGeometry: BufferGeometry | null
  selectedGeometry: BufferGeometry | null
}

type Built = {
  cellKey: string
  tube: TubeBuffers
  /** Mercator x, y, z of each point (for picking with the map's matrix). */
  merc: Float64Array
  takeoff: number
}

const CELL_DEGREES = 0.5
const MARKER_RADIUS_PX = 7.5

// aAlong is how far along its path a vertex is (0 to 1). Where it is behind uProgress (the part the replay has
// already flown) the tube glows a neon colour and swells a little; uNeon (0 to 1) fades that in and out.
const TUBE_VERTEX = `
attribute vec3 aOffset;
attribute float aAlong;
uniform float uRadius;
uniform float uProgress;
uniform float uNeon;
varying vec3 vNormal;
varying float vTrail;
void main() {
  vNormal = aOffset;
  float trail = uNeon * (1.0 - smoothstep(uProgress - 0.002, uProgress + 0.002, aAlong)) * step(0.0, uProgress);
  vTrail = trail;
  vec3 p = position + aOffset * uRadius * (1.0 + 0.5 * trail);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`

const TUBE_FRAGMENT = `
uniform vec3 uColor;
uniform vec3 uNeonColor;
varying vec3 vNormal;
varying float vTrail;
void main() {
  float light = 0.64 + 0.36 * dot(normalize(vNormal), normalize(vec3(0.35, -0.25, 0.9)));
  vec3 lit = uColor * light;
  vec3 glow = uNeonColor * (0.92 + 0.3 * light);
  gl_FragColor = vec4(mix(lit, glow, vTrail), 1.0);
}`

const MARKER_VERTEX = `
uniform float uRadius;
varying vec3 vNormal;
void main() {
  vNormal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uRadius, 1.0);
}`

const MARKER_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
void main() {
  float light = 0.5 + 0.5 * dot(normalize(vNormal), normalize(vec3(0.35, -0.25, 0.9)));
  vec3 base = mix(uColor, vec3(1.0), 0.45);
  gl_FragColor = vec4(base * (0.6 + 0.4 * light), uOpacity);
}`

/** The bright colour of the part of a flight already flown. */
const NEON_COLOR = '#ff8a1e'

function rgb(hex: string): Vector3 {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return new Vector3(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

function lighten(color: Vector3, amount: number): Vector3 {
  return new Vector3(color.x + (1 - color.x) * amount, color.y + (1 - color.y) * amount, color.z + (1 - color.z) * amount)
}

/** Meters per screen pixel at the middle of the map. */
function metersPerPixel(map: MapLibreMap): number {
  return (78271.517 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom()
}

export class FlyoverLayer implements CustomLayerInterface {
  readonly id = 'flyover'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map: MapLibreMap | null = null
  private renderer: WebGLRenderer | null = null
  private readonly camera = new Camera()
  private readonly main = new Matrix4()
  private readonly local = new Matrix4()

  private flights = new Map<string, TubeFlight>()
  private built = new Map<string, Built>()
  private cells = new Map<string, Cell>()
  private selectedId: string | null = null
  private exaggeration = 1

  private readonly baseMaterial: ShaderMaterial
  private readonly selectedMaterial: ShaderMaterial

  private marker: MarkerState | null = null
  private markerScene: Scene | null = null
  private markerMesh: Mesh | null = null
  private markerMaterial: ShaderMaterial | null = null
  private markerOrigin = {x: 0, y: 0, s: 1}

  constructor(options: {tubeColor: string; tubePx?: number; selectedPx?: number}) {
    const color = rgb(options.tubeColor)
    this.tubePx = options.tubePx ?? 1.7
    this.selectedPx = options.selectedPx ?? 3.2
    const neon = rgb(NEON_COLOR)
    const make = (c: Vector3) =>
      new ShaderMaterial({
        vertexShader: TUBE_VERTEX,
        fragmentShader: TUBE_FRAGMENT,
        uniforms: {
          uRadius: {value: 1},
          uColor: {value: c},
          uNeonColor: {value: neon},
          // No trail unless told (negative means none).
          uProgress: {value: -1},
          uNeon: {value: 0},
        },
        side: DoubleSide,
      })
    this.baseMaterial = make(color)
    this.selectedMaterial = make(lighten(color, 0.18))
  }

  private readonly tubePx: number
  private readonly selectedPx: number

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map
    this.renderer = new WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true})
    this.renderer.autoClear = false
    this.rebuild()
    this.buildMarker()
  }

  onRemove() {
    this.disposeCells()
    this.disposeMarker()
    this.baseMaterial.dispose()
    this.selectedMaterial.dispose()
    this.renderer?.dispose()
    this.renderer = null
    this.map = null
  }

  /** Replaces the flights drawn as tubes. Anything not in the list is released. */
  setFlights(flights: TubeFlight[]) {
    const next = new Map(flights.map((flight) => [flight.id, flight]))
    // Same flights, same points (a pan that changed nothing): keep what's built, just check the ground.
    const unchanged =
      next.size === this.flights.size &&
      [...next].every(([id, flight]) => this.flights.get(id)?.points === flight.points)
    this.flights = next
    if (unchanged) this.refreshTerrain()
    else this.rebuild()
  }

  setSelected(id: string | null) {
    if (id === this.selectedId) return
    this.selectedId = id
    if (this.built.size > 0) this.rebuild()
  }

  /**
   * Lights up the part of the open flight's tube that the replay has already flown: `progress` is how far along
   * (0 to 1) and `neon` how strongly it glows (0 to 1). `null` turns the trail off.
   */
  setTrail(progress: number | null, neon: number) {
    this.selectedMaterial.uniforms.uProgress!.value = progress == null ? -1 : progress
    this.selectedMaterial.uniforms.uNeon!.value = neon
    this.map?.triggerRepaint()
  }

  setMarker(marker: MarkerState | null) {
    this.marker = marker
    this.map?.triggerRepaint()
  }

  /** The terrain tiles may have loaded since the tubes were built: redo the altitudes if the ground moved. */
  refreshTerrain(): boolean {
    const map = this.map
    if (!map || this.built.size === 0) return false
    const exaggeration = map.getTerrain()?.exaggeration ?? 1
    let changed = Math.abs(exaggeration - this.exaggeration) > 1e-6
    if (!changed) {
      for (const [id, built] of this.built) {
        const first = this.flights.get(id)?.points[0]
        if (!first) continue
        const takeoff = map.queryTerrainElevation([first[0], first[1]]) ?? 0
        if (Math.abs(takeoff - built.takeoff) > 0.75) {
          changed = true
          break
        }
      }
    }
    if (changed) this.rebuild()
    return changed
  }

  /** The flight whose tube is nearest a screen point (within `maxPx`), if any. */
  pick(x: number, y: number, maxPx = 14): string | null {
    const map = this.map
    if (!map || this.built.size === 0) return null
    const width = map.getContainer().clientWidth
    const height = map.getContainer().clientHeight
    const e = this.main.elements
    const project = (mx: number, my: number, mz: number): [number, number] | null => {
      const w = e[3]! * mx + e[7]! * my + e[11]! * mz + e[15]!
      if (w <= 0) return null
      const cx = (e[0]! * mx + e[4]! * my + e[8]! * mz + e[12]!) / w
      const cy = (e[1]! * mx + e[5]! * my + e[9]! * mz + e[13]!) / w
      return [(cx * 0.5 + 0.5) * width, (1 - (cy * 0.5 + 0.5)) * height]
    }
    let best: string | null = null
    let bestDistance = maxPx
    for (const [id, built] of this.built) {
      let prev: [number, number] | null = null
      for (let i = 0; i < built.merc.length; i += 3) {
        const p = project(built.merc[i]!, built.merc[i + 1]!, built.merc[i + 2]!)
        if (p && prev) {
          const d = distanceToSegment(x, y, prev, p)
          if (d < bestDistance) {
            bestDistance = d
            best = id
          }
        }
        prev = p
      }
    }
    return best
  }

  get tubeCount() {
    return this.built.size
  }

  /** The flights that currently have a tube. */
  tubeIds(): string[] {
    return [...this.built.keys()]
  }

  render(_gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const map = this.map
    const renderer = this.renderer
    if (!map || !renderer) return
    this.main.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
    if (this.cells.size === 0 && !this.marker) return

    const mpp = metersPerPixel(map)
    this.baseMaterial.uniforms.uRadius!.value = this.tubePx * mpp
    this.selectedMaterial.uniforms.uRadius!.value = this.selectedPx * mpp

    renderer.resetState()
    for (const cell of this.cells.values()) {
      this.camera.projectionMatrix.copy(this.main).multiply(this.placed(cell.origin))
      renderer.render(cell.scene, this.camera)
    }
    if (this.marker && this.markerScene && this.markerMesh && this.markerMaterial) {
      this.updateMarker(mpp)
      this.camera.projectionMatrix.copy(this.main).multiply(this.placed(this.markerOrigin))
      renderer.render(this.markerScene, this.camera)
    }
  }

  /** Local meters -> mercator, for an origin. */
  private placed(origin: {x: number; y: number; s: number}): Matrix4 {
    return this.local.makeTranslation(origin.x, origin.y, 0).scale(new Vector3(origin.s, -origin.s, origin.s))
  }

  private rebuild() {
    const map = this.map
    this.disposeCells()
    this.built.clear()
    if (!map) return
    this.exaggeration = map.getTerrain()?.exaggeration ?? 1

    const perCell = new Map<string, {base: TubeBuffers[]; selected: TubeBuffers[]}>()
    for (const flight of this.flights.values()) {
      const first = flight.points[0]
      if (!first || flight.points.length < 2) continue
      const key = `${Math.floor(first[1] / CELL_DEGREES)},${Math.floor(first[0] / CELL_DEGREES)}`
      let cell = this.cells.get(key)
      if (!cell) {
        const origin = MercatorCoordinate.fromLngLat([first[0], first[1]], 0)
        cell = {
          origin: {x: origin.x, y: origin.y, s: origin.meterInMercatorCoordinateUnits()},
          scene: new Scene(),
          meshes: [],
          baseGeometry: null,
          selectedGeometry: null,
        }
        this.cells.set(key, cell)
      }

      const takeoff = map.queryTerrainElevation([first[0], first[1]]) ?? 0
      const altitudes = absoluteAltitudes(flight.points, {
        takeoffElevation: takeoff,
        exaggeration: this.exaggeration,
        terrainAt: (lng, lat) => map.queryTerrainElevation([lng, lat]),
      })
      const local: Vec3[] = []
      const merc = new Float64Array(flight.points.length * 3)
      flight.points.forEach(([lng, lat], i) => {
        const m = MercatorCoordinate.fromLngLat([lng, lat], 0)
        local.push({x: (m.x - cell.origin.x) / cell.origin.s, y: -(m.y - cell.origin.y) / cell.origin.s, z: altitudes[i]!})
        merc[i * 3] = m.x
        merc[i * 3 + 1] = m.y
        merc[i * 3 + 2] = altitudes[i]! * cell.origin.s
      })
      const tube = buildTube(local, 5)
      this.built.set(flight.id, {cellKey: key, tube, merc, takeoff})
      const lists = perCell.get(key) ?? {base: [], selected: []}
      ;(flight.id === this.selectedId ? lists.selected : lists.base).push(tube)
      perCell.set(key, lists)
    }

    for (const [key, lists] of perCell) {
      const cell = this.cells.get(key)!
      if (lists.base.length > 0) cell.baseGeometry = this.attach(cell, mergeTubes(lists.base), this.baseMaterial)
      if (lists.selected.length > 0) cell.selectedGeometry = this.attach(cell, mergeTubes(lists.selected), this.selectedMaterial)
    }
    map.triggerRepaint()
  }

  private attach(cell: Cell, buffers: TubeBuffers, material: ShaderMaterial): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(buffers.center, 3))
    geometry.setAttribute('aOffset', new BufferAttribute(buffers.offset, 3))
    geometry.setAttribute('aAlong', new BufferAttribute(buffers.along, 1))
    geometry.setIndex(new BufferAttribute(buffers.index, 1))
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    cell.scene.add(mesh)
    cell.meshes.push(mesh)
    return geometry
  }

  private disposeCells() {
    for (const cell of this.cells.values()) {
      for (const mesh of cell.meshes) mesh.geometry.dispose()
      cell.scene.clear()
    }
    this.cells.clear()
  }

  private buildMarker() {
    this.markerMaterial = new ShaderMaterial({
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      uniforms: {uRadius: {value: 1}, uColor: {value: new Vector3(0.85, 0.47, 0.02)}, uOpacity: {value: 1}},
      transparent: true,
    })
    this.markerMesh = new Mesh(new SphereGeometry(1, 18, 12), this.markerMaterial)
    this.markerMesh.frustumCulled = false
    this.markerScene = new Scene()
    this.markerScene.add(this.markerMesh)
  }

  private updateMarker(mpp: number) {
    const marker = this.marker!
    const radius = MARKER_RADIUS_PX * mpp
    const origin = MercatorCoordinate.fromLngLat([marker.lng, marker.lat], 0)
    this.markerOrigin = {x: origin.x, y: origin.y, s: origin.meterInMercatorCoordinateUnits()}
    const z = marker.onGround ? marker.altitude + radius : marker.altitude
    this.markerMesh!.position.set(0, 0, z)
    this.markerMaterial!.uniforms.uRadius!.value = radius
    this.markerMaterial!.uniforms.uColor!.value = rgb(marker.color)
    this.markerMaterial!.uniforms.uOpacity!.value = marker.opacity
  }

  private disposeMarker() {
    this.markerMesh?.geometry.dispose()
    this.markerMaterial?.dispose()
    this.markerScene?.clear()
    this.markerScene = null
    this.markerMesh = null
    this.markerMaterial = null
  }
}

function distanceToSegment(px: number, py: number, a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby) / len2))
  return Math.hypot(px - (a[0] + t * abx), py - (a[1] + t * aby))
}
