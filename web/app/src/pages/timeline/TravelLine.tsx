import type { TravelStop } from "./travel.ts"

export const LANE_START = 22
export const LANE_STEP = 30
export const ROW_HEIGHT = 60
const WIDTH = 300
const STROKE = 3

export const laneX = (lane: number) => LANE_START + lane * LANE_STEP

export type TravelLineProps = {
  stop: TravelStop
  /** The lane of the next older row (below this one), if any: the line hops to it at the row's bottom. */
  olderLane: number | null
  /** There is a newer row above, so the line comes in from the top. */
  hasNewer: boolean
  newest: boolean
}

/** One row's slice of the travel line: a vertical stroke, the hop to the older row's lane, and the dot. */
export function TravelLine({ stop, olderLane, hasNewer, newest }: TravelLineProps) {
  const x = laneX(stop.lane)
  const mid = ROW_HEIGHT / 2
  const dot = newest
    ? "var(--color-accent-strong)"
    : stop.arrives
      ? "var(--color-accent)"
      : "var(--color-line-strong)"
  const showLabel = stop.place !== null && (stop.arrives || newest)
  return (
    <div className="relative w-full" style={{ height: ROW_HEIGHT }} data-lane={stop.lane}>
      <svg width={WIDTH} height={ROW_HEIGHT} className="absolute inset-0 overflow-visible" aria-hidden>
        <g stroke="var(--color-line-strong)" strokeWidth={STROKE} fill="none">
          <line x1={x} x2={x} y1={hasNewer ? 0 : mid} y2={olderLane === null ? mid : ROW_HEIGHT} />
          {olderLane !== null && olderLane !== stop.lane ? (
            <line x1={x} x2={laneX(olderLane)} y1={ROW_HEIGHT - STROKE / 2} y2={ROW_HEIGHT - STROKE / 2} />
          ) : null}
        </g>
        <circle cx={x} cy={mid} r={6} fill={dot} stroke="var(--color-surface)" strokeWidth={3} />
      </svg>
      {showLabel ? (
        <span
          className={`absolute top-1/2 -translate-y-1/2 text-12 font-semibold whitespace-nowrap ${newest ? "text-accent" : "text-ink-muted"}`}
          style={{ left: x + 14 }}
        >
          {stop.place}
        </span>
      ) : null}
    </div>
  )
}
