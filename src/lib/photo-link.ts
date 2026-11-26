import type {MapData, SelectedItem} from '@/lib/sanity/types'

export type PhotoLink = {
  kind: 'flight' | 'track'
  id: string
  title: string
  /** What to select to open it: flies the map to it. */
  target: SelectedItem
}

/** The flight (or else route) a photo belongs to, if it's on the map; null when there's none or it isn't shown. */
export function photoLink(data: Pick<MapData, 'pins' | 'flights' | 'tracks'>, photoId: string): PhotoLink | null {
  const pin = data.pins.find((item) => item._id === photoId)
  if (!pin) return null
  const flight = pin.flightId ? data.flights.find((item) => item._id === pin.flightId) : undefined
  if (flight) {
    return {kind: 'flight', id: flight._id, title: flight.title?.trim() || 'Flight', target: {kind: 'flight', id: flight._id, fly: true}}
  }
  const track = pin.routeId ? data.tracks.find((item) => item._id === pin.routeId) : undefined
  if (track) {
    return {kind: 'track', id: track._id, title: track.title?.trim() || 'Route', target: {kind: 'track', id: track._id, fly: true}}
  }
  return null
}
