/** Seconds before flight start when a photo still links. */
export const PHOTO_LINK_PADDING_BEFORE_SEC = 5
/** Seconds after flight end when a photo still links. */
export const PHOTO_LINK_PADDING_AFTER_SEC = 15

export function photoLinkWindow(startedAtIso: string, durationSeconds: number): {start: string; end: string} {
  const startMs = new Date(startedAtIso).getTime()
  const endMs = startMs + durationSeconds * 1000
  return {
    start: new Date(startMs - PHOTO_LINK_PADDING_BEFORE_SEC * 1000).toISOString(),
    end: new Date(endMs + PHOTO_LINK_PADDING_AFTER_SEC * 1000).toISOString(),
  }
}