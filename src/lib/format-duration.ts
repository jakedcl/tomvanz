/** Consistent flight/route duration label (e.g. `5m 21s`) for cards and charts. */
export function formatDurationSeconds(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m <= 0) return `${s}s`
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}