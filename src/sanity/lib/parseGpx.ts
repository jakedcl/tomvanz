export type LineString = {
  type: 'LineString'
  coordinates: [number, number][]
}

/** A GPX file's track line plus the little it says about itself (all optional). */
export type GpxRoute = {
  coordinates: [number, number][]
  /** The track's own name, e.g. "Afternoon Ride". */
  name?: string
  /** What kind of activity the app that recorded it called it, e.g. "cycling". */
  type?: string
  /** When the track started, as written in the file. */
  time?: string
}

/** The text of the direct child `<tag>` of `parent`, if there is one. */
function childText(parent: Element | undefined, tag: string): string | undefined {
  if (!parent) return undefined
  for (const child of Array.from(parent.children)) {
    if (child.localName === tag) return child.textContent?.trim() || undefined
  }
  return undefined
}

export function readGpx(gpxText: string): GpxRoute {
  const doc = new DOMParser().parseFromString(gpxText, 'text/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('Couldn’t read that GPX.')
  }

  const coordinates: [number, number][] = []

  const trackPoints = Array.from(doc.getElementsByTagName('trkpt'))
  const routePoints = Array.from(doc.getElementsByTagName('rtept'))
  const points = trackPoints.length > 0 ? trackPoints : routePoints

  for (const point of points) {
    const lat = Number(point.getAttribute('lat'))
    const lon = Number(point.getAttribute('lon'))
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      coordinates.push([lon, lat])
    }
  }

  if (coordinates.length < 2) {
    throw new Error('That GPX has no track line.')
  }

  const track = doc.getElementsByTagName('trk')[0]
  const metadata = doc.getElementsByTagName('metadata')[0]
  return {
    coordinates,
    name: childText(track, 'name') ?? childText(metadata, 'name'),
    type: childText(track, 'type'),
    // The first point's time is when the activity began; the file's own time can be when it was exported.
    time: childText(points[0], 'time') ?? childText(metadata, 'time'),
  }
}

export function parseGpxToLine(gpxText: string): LineString {
  return {type: 'LineString', coordinates: readGpx(gpxText).coordinates}
}
