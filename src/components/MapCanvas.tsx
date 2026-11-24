'use client'

import {useCallback, useEffect, useRef} from 'react'
import {LngLatBounds, Map as MapLibreMap, Marker, NavigationControl} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@/lib/maplibre-worker'
import {pinViewPadding, shouldFlyToSelection, trackFitPadding} from '@/lib/map-focus'
import {urlFor} from '@/lib/sanity/image'
import {
  bunchNearPoint,
  fitBunchOnMap,
  overlappingPinBunch,
  type BunchMember,
} from '@/lib/map-bunch'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {trackColor} from '@/lib/track-color'
import type {FlightSeriesSample} from '@/lib/flight-log'
import {lineCoordinates, type MapData, SelectedItem} from '@/lib/sanity/types'
import type {StyleSpecification} from 'maplibre-gl'

const ESRI_ATTRIBUTION =
  'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
    },
  ],
}

type Props = {
  data: MapData
  threeD: boolean
  /** The person tilted the map by hand while 3D was off, so 3D should switch on. */
  onThreeDGesture: () => void
  selected: SelectedItem | null
  /** A pin to outline on the map without selecting it (the card being viewed in the pile strip). */
  highlightId: string | null
  onSelect: (item: SelectedItem | null) => void
  /** Overlapping photos and routes/flights at the same spot. */
  onPile: (members: BunchMember[]) => void
  /** Refit when the pile strip is showing (re-tap cluster). */
  pileMembers?: BunchMember[] | null
  onMapError: () => void
  /** Height of the bottom detail panel so routes fit above it. */
  panelHeight?: number
  onRegisterFlightScrub?: (handler: (sample: FlightSeriesSample | null) => void) => void
}

/** Marker for a photo that has no picture to show as a thumbnail. */
function pinSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" fill="#111" stroke="white" stroke-width="2"/></svg>`
}

function selectionPoint(data: MapData, selected: SelectedItem): [number, number] | null {
  if (selected.kind === 'pin') {
    const pin = data.pins.find((item) => item._id === selected.id)
    return pin ? [pin.location.lng, pin.location.lat] : null
  }
  if (selected.lng != null && selected.lat != null) {
    return [selected.lng, selected.lat]
  }
  if (selected.kind === 'flight') {
    const flight = data.flights.find((item) => item._id === selected.id)
    if (!flight) return null
    return lineCoordinates(flight.path)[0] ?? null
  }
  const track = data.tracks.find((item) => item._id === selected.id)
  if (!track) return null
  return lineCoordinates(track.route)[0] ?? null
}

const DEM_SOURCE_ID = 'terrain-dem'
const TILT_PITCH = 62
const TERRAIN_EXAGGERATION = 1.4

/** A hand-made tilt past this many degrees counts as asking for 3D. */
const GESTURE_TILT_DEGREES = 6

/**
 * Turn 3D terrain on or off. The elevation source is only added the first time it's needed.
 * `tilt` eases the camera to the preset angle; it's skipped when the person is already
 * tilting the map themselves.
 */
function applyThreeD(map: MapLibreMap, on: boolean, tilt = true) {
  if (on) {
    if (!map.getSource(DEM_SOURCE_ID)) {
      map.addSource(DEM_SOURCE_ID, {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain: Mapzen, Tilezen, USGS, NASA SRTM and others',
      })
    }
    map.setMaxPitch(80)
    map.setTerrain({source: DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION})
    map.setSky({
      'sky-color': '#8fb8e8',
      'horizon-color': '#dbe9f6',
      'fog-color': '#e8eef4',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.2,
    })
    if (tilt) map.easeTo({pitch: TILT_PITCH, duration: 900})
  } else {
    map.easeTo({pitch: 0, bearing: 0, duration: 700})
    map.once('moveend', () => {
      map.setTerrain(null)
      map.setMaxPitch(60)
    })
  }
}

/**
 * Pins whose thumbnails overlap the one that was tapped (including that pin). Only direct
 * neighbours count, so a long chain of overlapping photos doesn't turn into one giant pile.
 */
function openBunch(
  map: MapLibreMap,
  data: MapData,
  members: BunchMember[],
  onPile: (members: BunchMember[]) => void,
  panelHeight: number,
) {
  if (members.length > 1) {
    onPile(members)
    fitBunchOnMap(map, data, members, panelHeight)
    return true
  }
  return false
}

/** Bring a selected pin or track into view. Tapped tracks stay put; ones picked from a list or link fly to it. */
function focusSelection(
  map: MapLibreMap,
  data: MapData,
  selected: SelectedItem,
  duration: number,
  panelHeight: number,
) {
  if (!shouldFlyToSelection(selected)) return

  const mapHeight = map.getContainer().clientHeight
  if (selected.kind === 'track' || selected.kind === 'flight') {
    const line =
      selected.kind === 'track'
        ? data.tracks.find((item) => item._id === selected.id)?.route
        : data.flights.find((item) => item._id === selected.id)?.path
    if (!line) return
    const bounds = new LngLatBounds()
    for (const [lng, lat] of lineCoordinates(line)) bounds.extend([lng, lat])
    if (bounds.isEmpty()) return
    map.fitBounds(bounds, {
      padding: trackFitPadding(mapHeight, panelHeight),
      maxZoom: 15,
      duration,
    })
    return
  }
  const point = selectionPoint(data, selected)
  if (!point) return
  map.easeTo({
    center: point,
    zoom: Math.max(map.getZoom(), 11),
    padding: pinViewPadding(panelHeight),
    duration,
  })
}

function hitLayerIds(map: MapLibreMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .map((layer) => layer.id)
    .filter((id) => id.startsWith('track-hit-') || id.startsWith('flight-hit-'))
}

function flightScrubMarkerEl(heading: number): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '0'
  el.style.height = '0'
  el.style.pointerEvents = 'none'
  el.innerHTML = `<div style="position:relative;width:44px;height:44px;margin:-22px 0 0 -22px;transform:rotate(${heading}deg)">
    <div style="position:absolute;left:50%;top:4px;width:0;height:0;margin-left:-9px;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:22px solid rgba(217,119,6,0.85);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35))"></div>
    <div style="position:absolute;left:50%;top:20px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#fff;border:2px solid #d97706"></div>
  </div>`
  return el
}

export function MapCanvas({
  data,
  threeD,
  onThreeDGesture,
  selected,
  highlightId,
  onSelect,
  onPile,
  onMapError,
  panelHeight = 0,
  pileMembers = null,
  onRegisterFlightScrub,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const flightScrubRef = useRef<Marker | null>(null)
  const onSelectRef = useRef(onSelect)
  const onPileRef = useRef(onPile)
  const onThreeDGestureRef = useRef(onThreeDGesture)
  /** Set while 3D is being switched on by a tilt gesture, so the toggle doesn't also snap the camera. */
  const gestureEnabledRef = useRef(false)
  const activeIdRef = useRef<string | null>(null)
  /** True once the map's style has loaded; unlike map.loaded() it stays true while tiles download. */
  const readyRef = useRef(false)
  const selectedRef = useRef(selected)
  const onMapErrorRef = useRef(onMapError)
  const dataRef = useRef(data)
  const threeDRef = useRef(threeD)
  const panelHeightRef = useRef(panelHeight)

  useEffect(() => {
    panelHeightRef.current = panelHeight
  }, [panelHeight])

  useEffect(() => {
    selectedRef.current = selected
    onSelectRef.current = onSelect
    onPileRef.current = onPile
    onThreeDGestureRef.current = onThreeDGesture
    onMapErrorRef.current = onMapError
    dataRef.current = data
    threeDRef.current = threeD
  }, [selected, onSelect, onPile, onThreeDGesture, onMapError, data, threeD])

  const pinCtx = (): PinRenderCtx => ({
    data: dataRef.current,
    onSelect: onSelectRef.current,
    onPile: onPileRef.current,
    getActiveId: () => activeIdRef.current,
  })

  const onFlightScrub = useCallback((sample: FlightSeriesSample | null) => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!sample) {
      flightScrubRef.current?.remove()
      flightScrubRef.current = null
      return
    }
    if (!flightScrubRef.current) {
      const el = flightScrubMarkerEl(sample.heading)
      flightScrubRef.current = new Marker({element: el, anchor: 'center'}).setLngLat([sample.lng, sample.lat]).addTo(map)
      return
    }
    flightScrubRef.current.setLngLat([sample.lng, sample.lat])
    flightScrubRef.current.getElement().innerHTML = flightScrubMarkerEl(sample.heading).innerHTML
  }, [])

  useEffect(() => {
    onRegisterFlightScrub?.(onFlightScrub)
  }, [onFlightScrub, onRegisterFlightScrub])

  useEffect(() => {
    flightScrubRef.current?.remove()
    flightScrubRef.current = null
  }, [selected?.id, selected?.kind])

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container: node,
        style: STYLE,
        center: [0, 20],
        zoom: 1.4,
        attributionControl: {compact: true},
      })
    } catch {
      onMapErrorRef.current()
      return
    }

    mapRef.current = map
    map.addControl(new NavigationControl({showCompass: false}), 'bottom-right')
    map.on('error', (event) => {
      // A missing elevation tile just leaves the terrain flat; it shouldn't take down the map.
      if ((event as {sourceId?: string}).sourceId === DEM_SOURCE_ID) return
      onMapErrorRef.current()
    })
    map.on('click', (event) => {
      const layers = hitLayerIds(map)
      if (layers.length) {
        const hit = map.queryRenderedFeatures(event.point, {layers})[0]
        const id = hit?.properties?.id
        const layerId = hit?.layer?.id ?? ''
        if (typeof id === 'string' && id) {
          const kind = layerId.startsWith('flight-hit-') ? 'flight' : 'track'
          const primary: BunchMember = {kind, id}
          const bunch = bunchNearPoint(map, dataRef.current, event.lngLat.lng, event.lngLat.lat, primary)
          if (
            openBunch(map, dataRef.current, bunch, onPileRef.current, panelHeightRef.current)
          ) {
            return
          }
          onSelectRef.current({
            kind,
            id,
            lng: event.lngLat.lng,
            lat: event.lngLat.lat,
            fly: true,
          })
          return
        }
      }
      onSelectRef.current(null)
    })
    map.on('mousemove', (event) => {
      const layers = hitLayerIds(map)
      if (!layers.length) {
        map.getCanvas().style.cursor = ''
        return
      }
      const hovering = map.queryRenderedFeatures(event.point, {layers}).length > 0
      map.getCanvas().style.cursor = hovering ? 'pointer' : ''
    })
    map.on('load', () => {
      readyRef.current = true
      // The first draw fits everything in view; later redraws (search, filters) leave the camera alone.
      syncMap(map, dataRef.current, pinCtx(), markersRef, true)
      if (selectedRef.current) {
        focusSelection(map, dataRef.current, selectedRef.current, 0, panelHeightRef.current)
      }
      if (threeDRef.current) applyThreeD(map, true)
      // Start with the credits collapsed to a small (i) button; they still open on tap.
      const attrib = node.querySelector('.maplibregl-ctrl-attrib')
      attrib?.classList.remove('maplibregl-compact-show')
      attrib?.removeAttribute('open')
    })
    map.on('moveend', () => renderPins(map, pinCtx(), markersRef, false))
    // Tilting the map by hand (right-click or Ctrl drag, two-finger tilt) is asking for 3D.
    // Only gestures count: programmatic moves have no originalEvent.
    map.on('pitch', (event) => {
      if (!event.originalEvent || threeDRef.current || gestureEnabledRef.current) return
      if (map.getPitch() < GESTURE_TILT_DEGREES) return
      gestureEnabledRef.current = true
      onThreeDGestureRef.current()
    })

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = new Map()
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  const firstThreeD = useRef(true)
  useEffect(() => {
    if (firstThreeD.current) {
      firstThreeD.current = false
      return
    }
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const tilt = !gestureEnabledRef.current
    gestureEnabledRef.current = false
    applyThreeD(map, threeD, tilt)
  }, [threeD])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    syncMap(map, data, pinCtx(), markersRef, false)
  }, [data])

  useEffect(() => {
    activeIdRef.current = selected?.kind === 'pin' ? selected.id : highlightId
    markersRef.current.forEach((marker) => {
      const el = marker.getElement()
      el.dataset.active = el.dataset.id === activeIdRef.current ? 'true' : 'false'
    })
  }, [selected, highlightId, data])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const style = map.getStyle()
    for (const layer of style?.layers ?? []) {
      if (layer.id.startsWith('track-line-')) {
        const id = layer.id.slice('track-line-'.length)
        const on = selected?.kind === 'track' && selected.id === id
        map.setPaintProperty(layer.id, 'line-width', on ? 4.5 : 2.5)
      }
      if (layer.id.startsWith('flight-line-')) {
        const id = layer.id.slice('flight-line-'.length)
        const on = selected?.kind === 'flight' && selected.id === id
        map.setPaintProperty(layer.id, 'line-width', on ? 4.5 : 2.5)
      }
    }
  }, [selected, data])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !selected) return
    focusSelection(map, data, selected, 500, panelHeight)
  }, [selected, data, panelHeight])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !pileMembers || pileMembers.length < 2) return
    fitBunchOnMap(map, data, pileMembers, panelHeight)
  }, [pileMembers, data, panelHeight])

  return <div ref={rootRef} className="isolate h-full w-full" />
}

function clearTrackLayers(map: MapLibreMap) {
  const style = map.getStyle()
  if (!style?.layers) return
  for (const layer of [...style.layers]) {
    if (
      layer.id.startsWith('track-line-') ||
      layer.id.startsWith('track-casing-') ||
      layer.id.startsWith('track-hit-') ||
      layer.id.startsWith('flight-line-') ||
      layer.id.startsWith('flight-casing-') ||
      layer.id.startsWith('flight-hit-')
    ) {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id)
    }
  }
  const sources = style.sources ? Object.keys(style.sources) : []
  for (const id of sources) {
    if (id.startsWith('track-src-') || id.startsWith('flight-src-')) {
      if (map.getSource(id)) map.removeSource(id)
    }
  }
}

/**
 * The area the map may be panned to: the view that shows everything on the map, plus a generous margin on
 * every side, so you can look around and zoom out a little but can't drift off into empty ocean or desert.
 * It's built from the actual view (not just the photos' coordinates) so it always fits the screen shape.
 */
function limitBounds(view: LngLatBounds): [[number, number], [number, number]] {
  const sw = view.getSouthWest()
  const ne = view.getNorthEast()
  const latMargin = Math.max((ne.lat - sw.lat) * 0.75, 4)
  const lngMargin = Math.max((ne.lng - sw.lng) * 0.75, 6)
  return [
    [Math.max(-180, sw.lng - lngMargin), Math.max(-85, sw.lat - latMargin)],
    [Math.min(180, ne.lng + lngMargin), Math.min(85, ne.lat + latMargin)],
  ]
}

function syncMap(
  map: MapLibreMap,
  data: MapData,
  ctx: PinRenderCtx,
  markersRef: {current: Map<string, Marker>},
  /** Move the camera to show everything. Only the very first draw does; redraws never move the view. */
  fitToData: boolean,
) {
  clearTrackLayers(map)

  const bounds = new LngLatBounds()
  let hasPoint = false

  for (const track of data.tracks) {
    const coords = lineCoordinates(track.route)
    if (coords.length < 2) continue
    const color = trackColor(track.activity)
    const sourceId = `track-src-${track._id}`
    const layerId = `track-line-${track._id}`
    const hitId = `track-hit-${track._id}`
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {id: track._id},
        geometry: {type: 'LineString', coordinates: coords},
      },
    })
    const casingId = `track-casing-${track._id}`
    map.addLayer({
      id: casingId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': '#ffffff',
        'line-width': 6,
        'line-opacity': 0.88,
      },
    })
    map.addLayer({
      id: hitId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': color,
        'line-width': 18,
        'line-opacity': 0,
      },
    })
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': color,
        'line-width': 2.5,
        'line-dasharray': track.activity === 'hike' ? [2, 1.4] : [1, 0],
      },
    })
    for (const [lng, lat] of coords) {
      bounds.extend([lng, lat])
      hasPoint = true
    }
  }

  for (const flight of data.flights) {
    const coords = lineCoordinates(flight.path)
    if (coords.length < 2) continue
    const color = FLIGHT_PATH_COLOR
    const sourceId = `flight-src-${flight._id}`
    const layerId = `flight-line-${flight._id}`
    const hitId = `flight-hit-${flight._id}`
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {id: flight._id},
        geometry: {type: 'LineString', coordinates: coords},
      },
    })
    const casingId = `flight-casing-${flight._id}`
    map.addLayer({
      id: casingId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': '#ffffff',
        'line-width': 6,
        'line-opacity': 0.88,
      },
    })
    map.addLayer({
      id: hitId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': color,
        'line-width': 18,
        'line-opacity': 0,
      },
    })
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {'line-join': 'round', 'line-cap': 'round'},
      paint: {
        'line-color': color,
        'line-width': 2.5,
      },
    })
    for (const [lng, lat] of coords) {
      bounds.extend([lng, lat])
      hasPoint = true
    }
  }

  for (const pin of data.pins) {
    bounds.extend([pin.location.lng, pin.location.lat])
    hasPoint = true
  }

  if (fitToData) {
    if (hasPoint) {
      map.fitBounds(bounds, {padding: 72, maxZoom: 12, duration: 0})
      map.setMaxBounds(limitBounds(map.getBounds()))
    } else {
      map.setMaxBounds(null)
      map.jumpTo({center: [0, 20], zoom: 1.4})
    }
  }
  renderPins(map, ctx, markersRef, true)
}

type PinRenderCtx = {
  data: MapData
  onSelect: (item: SelectedItem | null) => void
  onPile: (members: BunchMember[]) => void
  getActiveId: () => string | null
}

/**
 * Draws a thumbnail marker for every pin in (or near) the current view, and drops the rest.
 * Keeps the page light however many photos there are; the look and stacking are unchanged.
 */
function renderPins(
  map: MapLibreMap,
  ctx: PinRenderCtx,
  markersRef: {current: Map<string, Marker>},
  force: boolean,
) {
  if (force) {
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = new Map()
  }
  const view = map.getBounds()
  const padLng = (view.getEast() - view.getWest()) * 0.25
  const padLat = (view.getNorth() - view.getSouth()) * 0.25
  const west = view.getWest() - padLng
  const east = view.getEast() + padLng
  const south = view.getSouth() - padLat
  const north = view.getNorth() + padLat

  const wanted = new Set<string>()
  ctx.data.pins.forEach((pin, index) => {
    const {lng, lat} = pin.location
    if (lng < west || lng > east || lat < south || lat > north) return
    wanted.add(pin._id)
    if (markersRef.current.has(pin._id)) return

    const thumb = pin.photo?.asset ? urlFor(pin.photo).width(80).height(80).fit('crop').url() : ''
    const el = document.createElement('button')
    el.type = 'button'
    el.dataset.kind = 'pin'
    el.dataset.id = pin._id
    el.dataset.active = ctx.getActiveId() === pin._id ? 'true' : 'false'
    el.setAttribute('aria-label', pin.title?.trim() || 'Photo')
    // Later pins sit on top, exactly as when every marker was added in order.
    el.style.zIndex = String(index)
    // The button only positions the marker; the visible photo sits in an inner layer so the
    // active photo can scale up without MapLibre's position transform being scaled with it.
    const inner = document.createElement('span')
    inner.className = 'tv-pin'
    el.style.padding = '0'
    el.style.border = '0'
    el.style.background = 'transparent'
    if (thumb) {
      el.style.width = '28px'
      el.style.height = '28px'
      inner.style.width = '100%'
      inner.style.height = '100%'
      inner.style.boxSizing = 'border-box'
      inner.style.border = '1px solid white'
      inner.style.borderRadius = '2px'
      inner.style.boxShadow = '0 1px 4px rgba(0,0,0,0.28)'
      inner.style.backgroundImage = `url(${thumb})`
      inner.style.backgroundSize = 'cover'
      inner.style.backgroundPosition = 'center'
      inner.style.backgroundColor = '#111'
    } else {
      inner.innerHTML = pinSvg()
      el.style.lineHeight = '0'
    }
    el.appendChild(inner)
    el.style.cursor = 'pointer'
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      const pinGroup = overlappingPinBunch(map, ctx.data.pins, pin)
      const members = bunchNearPoint(map, ctx.data, pin.location.lng, pin.location.lat, {
        kind: 'pin',
        id: pin._id,
      })
      if (members.length > 1) {
        const pinFirst = [
          {kind: 'pin' as const, id: pin._id},
          ...members.filter((m) => m.id !== pin._id),
        ]
        ctx.onPile(pinFirst)
        fitBunchOnMap(map, ctx.data, pinFirst, 0)
        void pinGroup
        return
      }
      ctx.onSelect({kind: 'pin', id: pin._id})
    })
    markersRef.current.set(
      pin._id,
      new Marker({element: el, anchor: 'center'}).setLngLat([lng, lat]).addTo(map),
    )
  })

  markersRef.current.forEach((marker, id) => {
    if (wanted.has(id)) return
    marker.remove()
    markersRef.current.delete(id)
  })
}
