/** An ISO date-time, or nothing for obviously bogus clocks (devices that were never set report 1970 or 2000). */
export function plausibleTime(date: Date | null | undefined): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined
  if (date.getFullYear() < 2005 || date.getTime() > Date.now() + 86_400_000) return undefined
  return date.toISOString()
}