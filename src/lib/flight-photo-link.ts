import {effectiveTakenAt} from './photo-taken-at.ts'

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

export type PhotoLinkCandidate = {
  _id: string
  takenAt?: string
  fileName?: string
  exifDateTimeOriginal?: string
}

export type PhotoLinkPlan = {
  linkIds: string[]
  /** Drone-ish names in the window we could not time — left unlinked for manual follow-up. */
  unlinkedLabels: string[]
}

function inWindow(iso: string, start: string, end: string): boolean {
  const t = new Date(iso).getTime()
  return t >= new Date(start).getTime() && t <= new Date(end).getTime()
}

function labelFor(candidate: PhotoLinkCandidate): string {
  return candidate.fileName?.trim() || candidate._id
}

/** Decide which photos to attach to a flight and which lack a usable timestamp. */
export function planPhotoLinks(
  candidates: PhotoLinkCandidate[],
  startedAt: string,
  durationSeconds: number,
): PhotoLinkPlan {
  const {start, end} = photoLinkWindow(startedAt, durationSeconds)
  const linkIds: string[] = []
  const unlinkedLabels: string[] = []

  for (const photo of candidates) {
    const when = effectiveTakenAt(photo.takenAt, photo.fileName, photo.exifDateTimeOriginal)
    if (when && inWindow(when, start, end)) {
      linkIds.push(photo._id)
      continue
    }
    const looksDrone = /(^dji_|^DJI_)/.test(photo.fileName ?? '')
    if (looksDrone && !when) {
      unlinkedLabels.push(labelFor(photo))
    }
  }

  return {linkIds, unlinkedLabels}
}