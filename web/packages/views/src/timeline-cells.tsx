import { Fragment, type ReactNode } from "react"
import { Chip } from "@troubadour/ui/chip"
import { SegmentedBar } from "@troubadour/ui/segmented-bar"
import type { TalkSegment } from "./talk-segments"
import { TravelLine } from "./travel-line"
import type { TravelStop } from "./travel"

/** One session as the timeline shows it (the app's API and the website's `_Overview/Timeline.md` agree). */
export interface TimelineSession {
  id: string
  kind: "recording" | "notes"
  n: number
  date: string
  title: string | null
  new_entities: { name: string; type: string }[]
  facts_accepted: number
}

const TIMELINE_COLUMNS = ["Session", "Where", "Who talked", "New faces", "Facts"]
const TIMELINE_WIDTHS = [200, 300, 280, undefined, 90]
const CELL = "border-l border-line-subtle px-4"
const FACT_BAR_MAX = 56

// "YYYY-MM-DD" in the campaign's local time; formatted without a timezone shift.
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const shortDate = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`))

/** The header row's cells. */
export function TimelineHead() {
  return (
    <tr className="bg-sunken font-serif font-bold text-ink-muted">
      {TIMELINE_COLUMNS.map((name, i) => (
        <th
          key={name}
          style={{ width: TIMELINE_WIDTHS[i] }}
          className={`border-b border-line py-2.5 text-left ${i === 0 ? "px-4" : CELL} ${i === 4 ? "text-right" : ""}`}
        >
          {name}
        </th>
      ))}
    </tr>
  )
}

/**
 * One timeline row's cells: number and title, the travel line, who talked, new faces, facts accepted. Links are
 * the caller's (react-router in the app, next/link on the website).
 */
export function TimelineCells({
  session,
  stop,
  olderLane,
  newest,
  talk,
  maxFacts,
  sessionLink,
  entityLink,
}: {
  session: TimelineSession
  stop: TravelStop
  olderLane: number | null
  newest: boolean
  talk: TalkSegment[]
  maxFacts: number
  sessionLink: (content: ReactNode) => ReactNode
  entityLink: (name: string, content: ReactNode) => ReactNode
}) {
  const barWidth = (session.facts_accepted / maxFacts) * FACT_BAR_MAX
  return (
    <>
      <td className="px-4">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          {sessionLink(<span className="font-serif font-bold text-ink">S{session.n}</span>)}
          <span className="text-12 text-ink-subtle">{shortDate(session.date)}</span>
        </div>
        <div className={`truncate text-13 ${newest ? "text-ink" : "text-ink-muted"}`}>
          {session.title ?? "Untitled"}
        </div>
      </td>
      <td className="relative border-l border-line-subtle p-0">
        <TravelLine stop={stop} olderLane={olderLane} hasNewer={!newest} newest={newest} />
      </td>
      <td className={CELL}>
        {session.kind === "notes" ? (
          <div className="text-12 text-ink-subtle">From notes</div>
        ) : (
          <SegmentedBar segments={talk} height={18} gap={1} labels />
        )}
      </td>
      <td className={CELL}>
        <div className="flex flex-wrap items-center gap-1.5">
          {session.new_entities.map((e) => (
            <Fragment key={e.name}>
              {entityLink(
                e.name,
                <Chip
                  className={`rounded-sm px-2 py-0.5 text-12 ${e.type === "item" ? "text-legendary" : ""}`}
                >
                  {e.name}
                </Chip>,
              )}
            </Fragment>
          ))}
        </div>
      </td>
      <td className={CELL}>
        <div className="flex items-center justify-end gap-2">
          <span className="h-1.5 rounded-sm bg-accent-strong" style={{ width: barWidth }} />
          <span className="w-5 text-right text-13 text-ink-muted tabular-nums">{session.facts_accepted}</span>
        </div>
      </td>
    </>
  )
}
