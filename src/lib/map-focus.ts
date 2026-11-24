import type {MapData, SelectedItem} from '@/lib/sanity/types'
import {lineCoordinates} from '@/lib/sanity/types'

export type FitPadding = {
  top: number
  bottom: number
  left: number
  right: number
}

/** Padding so a route/flight line fits in the map area above the bottom detail panel. */
export function trackFitPadding(mapHeight: number, panelHeight: number): FitPadding {
  const bottom = Math.max(panelHeight + 20, 56)
  return {
    top: Math.min(120, Math.round(mapHeight * 0.1)),
    bottom,
    left: 40,
    right: 40,
  }
}

/** Padding when centering a photo pin with the bottom panel open. */
export function pinViewPadding(panelHeight: number): FitPadding {
  return {
    top: 48,
    bottom: Math.max(panelHeight + 24, 56),
    left: 32,
    right: 32,
  }
}

export function lineBoundsForItem(data: MapData, selected: SelectedItem): [number, number][] | null {
  if (selected.kind === 'track') {
    const track = data.tracks.find((item) => item._id === selected.id)
    if (!track) return null
    const coords = lineCoordinates(track.route)
    return coords.length >= 2 ? coords : null
  }
  if (selected.kind === 'flight') {
    const flight = data.flights.find((item) => item._id === selected.id)
    if (!flight) return null
    const coords = lineCoordinates(flight.path)
    return coords.length >= 2 ? coords : null
  }
  return null
}

export function shouldFlyToSelection(selected: SelectedItem): boolean {
  if (selected.kind === 'track' || selected.kind === 'flight') {
    return selected.fly === true
  }
  return true
}