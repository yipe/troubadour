import { useMemo, type ComponentProps } from "react"
import { Link, useNavigate } from "react-router"
import { TableVirtuoso, type ItemProps } from "react-virtuoso"
import { useLive } from "@troubadour/api/live"
import { useClasses } from "@troubadour/api/players"
import { useTimeline, type TimelineSession } from "@troubadour/api/timeline"
import { PageHeading } from "@troubadour/ui/page-heading"
import { Spinner } from "@troubadour/ui/spinner"
import { TimelineCells, TimelineHead } from "@troubadour/views/timeline-cells"
import { ROW_HEIGHT } from "@troubadour/views/travel-line"
import { travelStops, type TravelStop } from "@troubadour/views/travel"
import { playerColor } from "../../lib/players.ts"
import { talkSegments } from "../../lib/talk.ts"
import { paths } from "../../paths.ts"

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
            fixedHeaderContent={() => <TimelineHead />}
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
  return (
    <TimelineCells
      session={session}
      stop={stop}
      olderLane={olderLane}
      newest={newest}
      talk={talkSegments(session.talk, players, classes, "share")}
      maxFacts={maxFacts}
      sessionLink={(content) => (
        <Link
          to={paths.session(session.id)}
          onClick={(e) => e.stopPropagation()}
          className="hover:no-underline"
        >
          {content}
        </Link>
      )}
      entityLink={(name, content) => (
        <Link to={paths.codex(name)} onClick={(ev) => ev.stopPropagation()}>
          {content}
        </Link>
      )}
    />
  )
}
