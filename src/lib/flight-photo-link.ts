import {
  planPhotoLinks as planPhotoLinksCore,
  type FlightLinkTarget,
  type PhotoLinkCandidate,
  type PhotoLinkPlan,
} from './photo-auto-link'

export type {PhotoLinkCandidate, PhotoLinkPlan} from './photo-auto-link'

/** Seconds before flight start when a photo still links (ground routes / legacy GPX padding). */
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

/** Decide which drone photos to attach to a flight and which lack a usable timestamp or aircraft match. */
export function planPhotoLinks(
  candidates: PhotoLinkCandidate[],
  flightOrStartedAt: FlightLinkTarget | string,
  durationSeconds?: number,
  options?: Pick<FlightLinkTarget, 'endedAt' | 'aircraft' | 'trackCoords'>,
): PhotoLinkPlan {
  const flight: FlightLinkTarget =
    typeof flightOrStartedAt === 'string'
      ? {
          _id: '',
          startedAt: flightOrStartedAt,
          durationSeconds: durationSeconds ?? 0,
          endedAt: options?.endedAt,
          aircraft: options?.aircraft,
          trackCoords: options?.trackCoords,
        }
      : flightOrStartedAt
  return planPhotoLinksCore(candidates, flight)
}