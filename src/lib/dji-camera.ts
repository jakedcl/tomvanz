/** DJI internal camera codes → aircraft label (matches flight log `aircraft` strings). */
export const DJI_CAMERA_MODEL_TO_AIRCRAFT: Record<string, string> = {
  FC3682: 'DJI Mini 3',
  FC2103: 'DJI Mavic Air',
  FC3411: 'DJI Air 2S',
}

export function aircraftFromCameraModel(model: string | null | undefined): string | undefined {
  const code = model?.trim().toUpperCase()
  if (!code) return undefined
  return DJI_CAMERA_MODEL_TO_AIRCRAFT[code]
}

function normalizeAircraft(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** True when the photo's camera model matches this flight's aircraft label. */
export function aircraftMatchesPhotoModel(
  flightAircraft: string | undefined,
  cameraModel: string | undefined,
  cameraMake?: string,
): boolean {
  const fromCode = aircraftFromCameraModel(cameraModel)
  if (fromCode && flightAircraft) {
    return normalizeAircraft(fromCode) === normalizeAircraft(flightAircraft)
  }
  if (!flightAircraft?.trim()) return false
  const model = cameraModel?.trim() ?? ''
  const make = cameraMake?.trim() ?? ''
  const hay = normalizeAircraft(`${make} ${model}`)
  const needle = normalizeAircraft(flightAircraft)
  return hay.includes(needle) || needle.includes(hay)
}
