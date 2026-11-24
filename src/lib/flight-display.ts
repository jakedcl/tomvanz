import type {FlightSeriesSample} from './flight-log'

/** Map raw DJI / parser mode strings to a short flight-card pill. */
export function flightModePillLabel(mode: string): string | null {
  const raw = mode.trim()
  if (!raw) return null
  const m = raw.toLowerCase()
  if (m.includes('sport') || m === 's-mode' || m === 's_mode') return 'Sport mode'
  if (m.includes('cine') || m.includes('cinematic')) return 'Cinematic mode'
  if (m.includes('tripod') || m.includes('easy') || m.includes('beginner')) return 'Normal mode'
  if (m.includes('normal') || m.includes('p-gps') || m.includes('patti') || m.includes('gps')) return 'Normal mode'
  if (m.includes('manual')) return 'Sport mode'
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