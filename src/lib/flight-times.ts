import {plausibleTime} from './plausible-time'

export function flightEndedAtIso(startedAt: string, durationSeconds: number): string | undefined {
  const startMs = new Date(startedAt).getTime()
  if (!Number.isFinite(startMs) || durationSeconds <= 0) return undefined
  return plausibleTime(new Date(startMs + durationSeconds * 1000))
}
