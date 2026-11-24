/** Stable map UI dates — en-US + Eastern, same on server and client for Tom's map content. */
export const MAP_DATE_TIME_ZONE = 'America/New_York'

export function formatMapDate(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: MAP_DATE_TIME_ZONE,
  })
}