import { Mic } from "lucide-react"
import { Link } from "react-router"
import type { SavedSession } from "@troubadour/api/sessions"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { NavItem } from "@troubadour/ui/nav-item"
import { dateShort, durationShort } from "../../lib/format.ts"
import { sessionStatus, type SessionStatus } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { sessionTitle } from "./stats.ts"

const STATUS: Record<SessionStatus, { label: string; tone: "warning" | "success" | "neutral" }> = {
  "needs-review": { label: "Needs review", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "success" },
  "not-written-up": { label: "Not written up", tone: "neutral" },
}

export type SessionListProps = {
  sessions: SavedSession[]
  selectedId: string | undefined
  writtenUp: Record<string, string>
  nextNumber: number
  /** A session is running or paused. */
  running: boolean
}

export function SessionList({ sessions, selectedId, writtenUp, nextNumber, running }: SessionListProps) {
  return (
    <div className="flex flex-col">
      <div className="flex gap-2 border-b border-line p-4">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          nativeButton={false}
          render={<Link to={running ? paths.live() : paths.ready()} />}
        >
          <Mic className="size-3.5" />
          {running ? "Back to the session" : `Prepare session ${nextNumber}`}
        </Button>
        <Button size="lg" nativeButton={false} render={<Link to={paths.ready("file")} />}>
          Import audio
        </Button>
      </div>
      <nav aria-label="Saved sessions" className="flex flex-col gap-1.5 p-2">
        {sessions.map((s) => {
          const status = STATUS[sessionStatus(s, s.id in writtenUp)]
          return (
            <NavItem
              key={s.id}
              selected={s.id === selectedId}
              render={<Link to={paths.session(s.id)} />}
              count={durationShort(s.duration_s)}
              sub={
                <span className="flex items-center gap-2">
                  <span>{dateShort(s.started_at)}</span>
                  <Badge tone={status.tone} className="ml-auto">
                    {status.label}
                  </Badge>
                </span>
              }
            >
              <span className="font-semibold">
                <span className="mr-2 inline-block w-7 font-mono text-12 font-normal text-ink-subtle">
                  {s.n === null ? "" : `S${s.n}`}
                </span>
                {sessionTitle(s)}
              </span>
            </NavItem>
          )
        })}
      </nav>
    </div>
  )
}
