import type {FlightSeriesSample} from './flight-log'

/** Collapse `GPS Atti` / `P-GPS` / `GPSAtti` to one token for lookup. */
function flycStateKey(mode: string): string {
  return mode
    .trim()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .toLowerCase()
}

const IGNORED_FLYC = new Set([
  'landing',
  'takeoff',
  'gohome',
  'autotakeoff',
  'autolanding',
])

/** Map raw DJI `osd.flycState` to the label on the flight card pill. */
export function flightModePillLabel(mode: string): string | null {
  const raw = mode.trim()
  if (!raw) return null
  const key = flycStateKey(raw)
  if (IGNORED_FLYC.has(key)) return null

  if (key === 'gpsatti' || key === 'gpsnormal' || key === 'p-gps' || key === 'pgps') return 'Normal mode'
  if (key === 'gpssport' || key === 'sport') return 'Sport mode'
  if (
    key === 'tripod' ||
    key === 'gpstripod' ||
    key === 'cine' ||
    key === 'gpscine' ||
    key === 'gpsgentle' ||
    key.startsWith('cine')
  ) {
    return 'Cinematic mode'
  }
  if (key === 'atti') return 'Atti mode'
  if (key === 'manual') return 'Manual mode'

  return null
}

export function dominantFlightModePill(samples: FlightSeriesSample[]): string | null {
  const counts = new Map<string, number>()
  for (const sample of samples) {
    const label = flightModePillLabel(sample.mode)
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label
      bestCount = count
    }
  }
  return best
}

export function maxSpeedMphFromSeries(samples: FlightSeriesSample[]): number | null {
  if (samples.length === 0) return null
  const maxMs = Math.max(...samples.map((s) => s.speed).filter((v) => Number.isFinite(v)))
  if (!Number.isFinite(maxMs) || maxMs <= 0) return null
  return maxMs * 2.2369362921
}

export function formatSpeedMph(mph: number): string {
  return `${mph.toFixed(mph >= 10 ? 0 : 1)} mph top`
}