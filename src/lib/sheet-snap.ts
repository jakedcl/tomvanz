export const sheetLevels = ['peek', 'half', 'full'] as const
export type SheetLevel = (typeof sheetLevels)[number]
export type SheetHeights = Record<SheetLevel, number>

export function sheetHeights(height: number, peekHeight: number): SheetHeights {
  const peek = Math.min(height, peekHeight)
  return {peek, half: Math.max(peek, height * 0.52), full: Math.max(peek, height - 12)}
}

export function stepSheet(level: SheetLevel, direction: -1 | 1): SheetLevel {
  return sheetLevels[Math.max(0, Math.min(sheetLevels.length - 1, sheetLevels.indexOf(level) + direction))]
}

/** Positive velocity opens the sheet. A flick steps once, while a slower drag picks the closest stop. */
export function snapSheet(level: SheetLevel, height: number, velocity: number, heights: SheetHeights): SheetLevel {
  if (Math.abs(velocity) >= 0.5) return stepSheet(level, velocity > 0 ? 1 : -1)
  return sheetLevels.reduce(
    (nearest, stop) => Math.abs(heights[stop] - height) < Math.abs(heights[nearest] - height) ? stop : nearest,
    level,
  )
}
