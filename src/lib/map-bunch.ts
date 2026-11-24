import type {Map as MapLibreMap} from 'maplibre-gl'
import {LngLatBounds} from 'maplibre-gl'

import {pileTolerancePx} from './pile'
import {lineCoordinates, type FlightDoc, type MapData, type PinDoc, type TrackDoc} from './sanity/types'

export type BunchMember = {kind: 'pin' | 'track' | 'flight'; id: string}

function startOfTrack(track: TrackDoc): [number, number] | null {
  const coords = lineCoordinates(track.route)
  return coords[0] ?? null
}

function startOfFlight(flight: FlightDoc): [number, number] | null {
  const coords = lineCoordinates(flight.path)
  return coords[0] ?? null
}

function nearOnMap(map: MapLibreMap, a: [number, number], b: [number, number]): boolean {
  const pa = map.project(a)
  const pb = map.project(b)
  const tolerance = pileTolerancePx(map.getZoom())
  return Math.abs(pa.x - pb.x) < tolerance && Math.abs(pa.y - pb.y) < tolerance
}

/** Pins and routes/flights that share the same screen neighborhood (e.g. common start point). */
export function bunchNearPoint(
  map: MapLibreMap,
  data: MapData,
  lng: number,
  lat: number,
  primary?: BunchMember,
): BunchMember[] {
  const anchor: [number, number] = [lng, lat]
  const members: BunchMember[] = primary ? [primary] : []
  const seen = new Set(members.map((m) => `${m.kind}:${m.id}`))

  for (const pin of data.pins) {
    if (pin._id === primary?.id && primary.kind === 'pin') continue
    const pt: [number, number] = [pin.location.lng, pin.location.lat]
    if (nearOnMap(map, anchor, pt)) {
      const key = `pin:${pin._id}`
      if (!seen.has(key)) {
        seen.add(key)
        members.push({kind: 'pin', id: pin._id})
      }
    }
  }

  for (const track of data.tracks) {
    const start = startOfTrack(track)
    if (!start) continue
    if (track._id === primary?.id && primary.kind === 'track') continue
    if (nearOnMap(map, anchor, start)) {
      const key = `track:${track._id}`
      if (!seen.has(key)) {
        seen.add(key)
        members.push({kind: 'track', id: track._id})
      }
    }
  }

  for (const flight of data.flights) {
    const start = startOfFlight(flight)
    if (!start) continue
    if (flight._id === primary?.id && primary.kind === 'flight') continue
    if (nearOnMap(map, anchor, start)) {
      const key = `flight:${flight._id}`
      if (!seen.has(key)) {
        seen.add(key)
        members.push({kind: 'flight', id: flight._id})
      }
    }
  }

  return members
}

export function overlappingPinBunch(map: MapLibreMap, pins: PinDoc[], origin: PinDoc): PinDoc[] {
  const here: [number, number] = [origin.location.lng, origin.location.lat]
  const tolerance = pileTolerancePx(map.getZoom())
  return pins.filter((pin) => {
    if (pin._id === origin._id) return true
    const pt = map.project([pin.location.lng, pin.location.lat])
    const herePt = map.project(here)
    return Math.abs(pt.x - herePt.x) < tolerance && Math.abs(pt.y - herePt.y) < tolerance
  })
}

export function fitBunchOnMap(
  map: MapLibreMap,
  data: MapData,
  members: BunchMember[],
  panelHeight: number,
): void {
  const bounds = new LngLatBounds()
  for (const member of members) {
    if (member.kind === 'pin') {
      const pin = data.pins.find((p) => p._id === member.id)
      if (pin) bounds.extend([pin.location.lng, pin.location.lat])
    } else if (member.kind === 'track') {
      const track = data.tracks.find((t) => t._id === member.id)
      const start = track ? startOfTrack(track) : null
      if (start) bounds.extend(start)
    } else {
      const flight = data.flights.find((f) => f._id === member.id)
      const start = flight ? startOfFlight(flight) : null
      if (start) bounds.extend(start)
    }
  }
  if (bounds.isEmpty()) return
  const bottom = Math.max(panelHeight + 120, 200)
  map.fitBounds(bounds, {
    padding: {top: 96, bottom, left: 48, right: 48},
    maxZoom: 15,
    duration: 650,
  })
}