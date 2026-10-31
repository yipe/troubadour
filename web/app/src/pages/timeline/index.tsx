import { useMemo, type ComponentProps } from "react"
import { Link, useNavigate } from "react-router"
import { TableVirtuoso, type ItemProps } from "react-virtuoso"
import { useLive } from "@troubadour/api/live"
import { useClasses } from "@troubadour/api/players"
import { useTimeline, type TimelineSession } from "@troubadour/api/timeline"
import { Chip } from "@troubadour/ui/chip"
import { PageHeading } from "@troubadour/ui/page-heading"
import { SegmentedBar } from "@troubadour/ui/segmented-bar"
import { Spinner } from "@troubadour/ui/spinner"
import { hm } from "../../lib/format.ts"
import { playerColor } from "../../lib/players.ts"
import { talkSegments, topPlayer } from "../../lib/talk.ts"
import { paths } from "../../paths.ts"
import { ROW_HEIGHT, TravelLine } from "./TravelLine.tsx"
import { travelStops, type TravelStop } from "./travel.ts"

const COLUMNS = ["Session", "Where", "Who talked", "New faces", "Facts"]
const WIDTHS = [200, 300, 280, undefined, 90]
const CELL = "border-l border-line-subtle px-4"
const FACT_BAR_MAX = 56

// The server sends "YYYY-MM-DD" in local time; format it without a timezone shift.
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const shortDate = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`))

type Row = { session: TimelineSession; stop: TravelStop; olderLane: number | null; newest: boolean }

export function Component() {
  const timeline = useTimeline()
  const players = useLive((s) => s.players)
  const classes = useClasses().data ?? []
  const sessions = timeline.data?.sessions

  const { rows, maxFacts } = useMemo(() => {
    const newestFirst = sessions ?? []
    // The server sends newest first; the line is laid out from the oldest session.
    const stops = travelStops(newestFirst.map((s) => s.places).reverse()).reverse()
    const rows: Row[] = newestFirst.map((session, i) => ({
      session,
      stop: stops[i]!,
      olderLane: stops[i + 1]?.lane ?? null,
      newest: i === 0,
    }))
    return { rows, maxFacts: Math.max(1, ...newestFirst.map((s) => s.facts_accepted)) }
  }, [sessions])

  if (!sessions) return <Spinner />

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-5 pt-5 md:px-10">
      <PageHeading
        className="flex-wrap [&>div:first-child]:min-w-[14rem]"
        title="The story so far"
        subtitle={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} · newest first · scrolls as the campaign grows`}
        actions={
          <ul className="flex flex-wrap gap-4 text-12 text-ink-subtle">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <span className="size-2 rounded-xs" style={{ background: playerColor(p, classes) }} />
                {p.name}
                {p.is_gm ? " (GM)" : ""}
              </li>
            ))}
          </ul>
        }
      />
      {sessions.length === 0 ? (
        <p className="text-ink-subtle">No sessions yet. The story starts with the first one you record.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-t-lg border border-b-0 border-line bg-surface">
          <TableVirtuoso<Row>
            style={{ height: "100%" }}
            data={rows}
            fixedItemHeight={ROW_HEIGHT}
            computeItemKey={(_, r) => r.session.id}
            components={TABLE}
            fixedHeaderContent={() => (
              <tr className="bg-sunken font-serif font-bold text-ink-muted">
                {COLUMNS.map((name, i) => (
                  <th
                    key={name}
                    style={{ width: WIDTHS[i] }}
                    className={`border-b border-line py-2.5 text-left ${i === 0 ? "px-4" : CELL} ${i === 4 ? "text-right" : ""}`}
                  >
                    {name}
                  </th>
                ))}
              </tr>
            )}
            itemContent={(_, row) => <RowCells row={row} maxFacts={maxFacts} />}
          />
        </div>
      )}
    </div>
  )
}

function SessionTr({ item, ...props }: ItemProps<Row>) {
  const navigate = useNavigate()
  return (
    <tr
      {...props}
      onClick={() => void navigate(paths.session(item.session.id))}
      className={`cursor-pointer border-b border-line hover:bg-accent-soft ${item.newest ? "bg-accent-soft" : ""}`}
      style={{ height: ROW_HEIGHT }}
    />
  )
}

function FixedTable(props: ComponentProps<"table">) {
  return <table {...props} className="w-full min-w-[960px] table-fixed border-collapse text-14" />
}

// Module-level: components defined inline would remount every row on each render.
const TABLE = { Table: FixedTable, TableRow: SessionTr }

function RowCells({ row, maxFacts }: { row: Row; maxFacts: number }) {
  const { session, stop, olderLane, newest } = row
  const players = useLive((s) => s.players)
  const classes = useClasses().data ?? []
  const top = topPlayer(session.talk, players)
  const totalTalk = Object.values(session.talk).reduce((sum, s) => sum + Math.max(0, s), 0)
  const barWidth = (session.facts_accepted / maxFacts) * FACT_BAR_MAX
  return (
    <>
      <td className="px-4">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <Link
            to={paths.session(session.id)}
            onClick={(e) => e.stopPropagation()}
            className="font-serif font-bold text-ink hover:no-underline"
          >
            S{session.n}
          </Link>
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
        <SegmentedBar segments={talkSegments(session.talk, players, classes)} height={10} gap={1} />
        <div className="mt-1.5 text-11 text-ink-subtle">
          {top ? `Top player: ${top.player.name} ${top.pct}% · ${hm(totalTalk)}` : "No one named spoke"}
        </div>
      </td>
      <td className={CELL}>
        <div className="flex flex-wrap items-center gap-1.5">
          {session.new_entities.map((e) => (
            <Link key={e.name} to={paths.codex(e.name)} onClick={(ev) => ev.stopPropagation()}>
              <Chip className={`rounded-sm px-2 py-0.5 text-12 ${e.type === "item" ? "text-legendary" : ""}`}>
                {e.name}
              </Chip>
            </Link>
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
