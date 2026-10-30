import type { LevelZone } from "@troubadour/api/audio"
import { meterPosition, zoneOf } from "@troubadour/api/live"

export const BAR_COUNT = 48

/** One bar: the level it shows (null = nothing heard yet). */
export type Bar = number | null

export const emptyBars = (): Bar[] => Array.from({ length: BAR_COUNT }, () => null)

/** Newest reading on the right; the oldest falls off the left. */
export function pushBar(bars: Bar[], db: number | null): Bar[] {
  return [...bars.slice(1), db]
}

/** Bar height as a percentage of the meter. Silence keeps a hairline so the row still reads as a meter. */
export function barHeight(db: Bar): number {
  if (db == null) return 4
  return Math.max(4, Math.round(meterPosition(db) * 100))
}

export function barZone(db: Bar): LevelZone {
  return db == null ? "off" : zoneOf(db)
}

/** Tailwind colour per zone: quiet is grey, good green, hot amber, clipping red. */
export const BAR_CLASS: Record<LevelZone, string> = {
  off: "bg-line",
  silent: "bg-ink-subtle",
  quiet: "bg-ink-subtle",
  good: "bg-success",
  hot: "bg-warning",
  clip: "bg-danger",
}
