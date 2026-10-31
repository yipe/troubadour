import { useState, type ReactNode } from "react"
import { TableVirtuoso } from "react-virtuoso"
import { History } from "lucide-react"
import type { EntityType, Fact, FactSource } from "@troubadour/api/campaign"
import { useLiveStore } from "@troubadour/api/live"
import { useSessions } from "@troubadour/api/sessions"
import { cn } from "@troubadour/ui/cn"
import { Table, TD, TH, THead, TR } from "@troubadour/ui/table"
import { hms } from "../../lib/format.ts"
import { TimestampLink } from "../audio/TimestampLink.tsx"
import { ConfidenceBadge } from "../entity/ConfidenceBadge.tsx"
import { EntityLink } from "../entity/EntityLink.tsx"
import { FactText } from "../entity/FactText.tsx"
import { PlayerAvatar } from "../people/PlayerAvatar.tsx"

export type FactRow = { fact: Fact; about?: { name: string; type: EntityType } }

export type FactsTableProps = {
  rows: FactRow[]
  /** The codex shows the table under one entry, so it drops the About column. */
  showAbout?: boolean
  emptyText: string
  /** Rendered under the rows (an "add a fact" row). */
  addSlot?: ReactNode
}

/** Past this many rows the table is windowed; below it a plain table is simpler and prints. */
const VIRTUALIZE_AFTER = 300

function SaidBy({ saidBy }: { saidBy: Fact["said_by"] }) {
  const players = useLiveStore((s) => s.players)
  if (!saidBy) return <span className="text-ink-subtle">–</span>
  const player = players.find((p) => p.id === saidBy.player_id)
  return (
    <span className="flex items-center gap-2">
      <PlayerAvatar player={player} name={saidBy.name} size={24} />
      {saidBy.name}
    </span>
  )
}

function Source({ source }: { source: FactSource | null }) {
  const sessions = useSessions().data
  if (!source) return <span className="text-ink-subtle">–</span>
  if (source.session_id && source.t !== null) {
    const session = sessions?.find((s) => s.id === source.session_id)
    return (
      <TimestampLink
        sessionId={source.session_id}
        t={source.t}
        n={session?.n ?? undefined}
        label={session?.n ? undefined : (source.label ?? hms(source.t))}
        hasAudio={session?.audio ?? false}
      />
    )
  }
  return <span className="font-mono text-12 text-ink-subtle">{source.label ?? source.page}</span>
}

function VersionList({ fact }: { fact: Fact }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5 rounded-control bg-sunken px-3 py-2 text-13">
      {[
        { text: fact.text, said_by: fact.said_by, source: fact.source, current: true },
        ...fact.history.map((h) => ({ ...h, current: false })),
      ].map((v, i) => (
        <li key={i} className={cn("flex flex-wrap items-baseline gap-x-2", !v.current && "text-ink-subtle")}>
          <span className={cn(!v.current && "line-through")}>
            <FactText text={v.text} />
          </span>
          <span className="text-12 text-ink-subtle">
            {v.current ? "now" : (v.said_by?.name ?? "")}
            {v.source?.label ? ` · ${v.source.label}` : v.source?.t != null ? ` · ${hms(v.source.t)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  )
}

function changes(n: number): string {
  return n === 1 ? "Changed once" : `Changed ${n} times`
}

function FactCell({ fact }: { fact: Fact }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-0.5 text-pretty">
      <span>
        <FactText text={fact.text} />
      </span>
      {fact.history.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-fit items-center gap-1 text-12 text-accent hover:underline"
          >
            <History aria-hidden className="size-3" />
            {changes(fact.history.length)} · history {open ? "open" : "closed"}
          </button>
          {open ? <VersionList fact={fact} /> : null}
        </>
      ) : null}
    </div>
  )
}

function Cells({ row, showAbout }: { row: FactRow; showAbout: boolean }) {
  const { fact, about } = row
  return (
    <>
      <TD className="max-w-[44ch]">
        <FactCell fact={fact} />
      </TD>
      {showAbout ? (
        <TD>
          {about ? (
            <div className="flex flex-col">
              <EntityLink name={about.name} type={about.type} />
              <span className="text-12 text-ink-subtle">{about.type}</span>
            </div>
          ) : null}
        </TD>
      ) : null}
      <TD>
        <SaidBy saidBy={fact.said_by} />
      </TD>
      <TD>
        <Source source={fact.source} />
      </TD>
      <TD>
        <ConfidenceBadge confidence={fact.confidence} />
      </TD>
    </>
  )
}

export function FactsTable({ rows, showAbout = true, emptyText, addSlot }: FactsTableProps) {
  const head = (
    <tr>
      <TH>Fact</TH>
      {showAbout ? <TH>About</TH> : null}
      <TH>Said by</TH>
      <TH>Source</TH>
      <TH>How sure</TH>
    </tr>
  )
  if (rows.length === 0 && !addSlot)
    return <p className="py-6 text-center text-13 text-ink-subtle">{emptyText}</p>
  return (
    <div className="flex flex-col gap-2">
      {rows.length > VIRTUALIZE_AFTER ? (
        <TableVirtuoso
          useWindowScroll
          data={rows}
          components={{ Table, TableHead: THead, TableRow: TR }}
          fixedHeaderContent={() => head}
          itemContent={(_, row) => <Cells row={row} showAbout={showAbout} />}
        />
      ) : (
        <Table>
          <THead>{head}</THead>
          <tbody>
            {rows.map((row) => (
              <TR key={row.fact.id}>
                <Cells row={row} showAbout={showAbout} />
              </TR>
            ))}
          </tbody>
        </Table>
      )}
      {rows.length === 0 ? <p className="py-2 text-center text-13 text-ink-subtle">{emptyText}</p> : null}
      {addSlot}
    </div>
  )
}
