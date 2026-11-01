import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  GitMerge,
  GripVertical,
  Mic,
  NotebookPen,
  Plus,
  Trash2,
} from "lucide-react"
import { Link } from "react-router"
import { useCampaign } from "@troubadour/api/campaign"
import type { SavedSession } from "@troubadour/api/sessions"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { NavItem } from "@troubadour/ui/nav-item"
import { dateShort, durationShort } from "../../lib/format.ts"
import { sessionStatus, type SessionStatus } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { sessionTitle } from "./stats.ts"
import { AddNotesDialog, MergeDialog } from "./tools/index.ts"
import { notesStatus } from "./notesStatus.ts"
import { NotesStatusBadge } from "./NotesStatusBadge.tsx"
import { useRemoveSessions } from "./useRemoveSessions.ts"
import { useUnknownOrder } from "./useUnknownOrder.ts"

/** Sessions shorter than this are probably a mic test or a false start. */
export const VERY_SHORT_S = 60

const STATUS: Record<SessionStatus, { label: string; tone: "warning" | "success" | "neutral" }> = {
  "needs-review": { label: "Needs review", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "success" },
  "not-written-up": { label: "Not written up", tone: "neutral" },
}

export type SessionListProps = {
  sessions: SavedSession[]
  selectedId: string | undefined
  writtenUp: Record<string, string>
  /** A session is running or paused. */
  running: boolean
}

type Pending =
  { kind: "merge"; session: SavedSession; with: string } | { kind: "delete"; ids: string[] } | null

export function SessionList({ sessions, selectedId, writtenUp, running }: SessionListProps) {
  const remove = useRemoveSessions()
  const unknown = useUnknownOrder(sessions)
  const campaign = useCampaign().data
  const [pending, setPending] = useState<Pending>(null)
  const [onlyShort, setOnlyShort] = useState(false)
  const [addingNotes, setAddingNotes] = useState(false)

  // While a session runs it is saved as it goes, and is the newest in the list: it can't be deleted or merged yet.
  const liveId = running ? sessions.find((s) => s.kind === "recording")?.id : undefined
  const short = sessions.filter(
    (s) => s.kind === "recording" && s.duration_s < VERY_SHORT_S && s.id !== liveId,
  )
  const shown = onlyShort && short.length > 0 ? short : sessions

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
          {running ? "Back to the session" : "Prepare next session"}
        </Button>
        <Button size="lg" nativeButton={false} render={<Link to={paths.ready("file")} />}>
          Import audio
        </Button>
      </div>
      {short.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-warning-soft px-4 py-2 text-13">
          <span className="flex-1">
            {short.length === 1 ? "1 session is" : `${short.length} sessions are`} under a minute.
          </span>
          <Button variant="link" className="text-13" onClick={() => setOnlyShort(!onlyShort)}>
            {onlyShort ? "Show all" : "Review"}
          </Button>
          <Button
            variant="link"
            className="text-13"
            onClick={() => setPending({ kind: "delete", ids: short.map((s) => s.id) })}
          >
            Delete them…
          </Button>
        </div>
      )}
      <nav aria-label="Saved sessions" className="flex flex-col gap-1.5 p-2">
        {shown.map((s) => {
          const status = STATUS[sessionStatus(s, s.id in writtenUp)]
          // The list is newest first: the next session is the one above, the previous the one below.
          const at = sessions.indexOf(s)
          const isNotes = s.kind === "notes"
          // Notes can't be merged with a recording, and a notes session is no merge partner either.
          const next = isNotes || sessions[at - 1]?.kind === "notes" ? undefined : sessions[at - 1]
          const previous = isNotes || sessions[at + 1]?.kind === "notes" ? undefined : sessions[at + 1]
          const busy = s.id === liveId
          return (
            <div
              key={s.id}
              className={`group relative rounded-control ${unknown.over === s.id ? "ring-2 ring-accent" : ""}`}
              {...unknown.dragProps(s.id)}
            >
              <NavItem
                selected={s.id === selectedId}
                render={<Link to={paths.session(s.id)} />}
                count={
                  isNotes ? undefined : (
                    <span className="group-focus-within:invisible group-hover:invisible">
                      {durationShort(s.duration_s)}
                    </span>
                  )
                }
                sub={
                  <span className="flex items-center gap-2">
                    {unknown.canShift(s.id, 1) || unknown.canShift(s.id, -1) ? (
                      <GripVertical aria-hidden className="-ml-1 size-3.5 cursor-grab" />
                    ) : null}
                    <span>{dateShort(s.started_at)}</span>
                    {!isNotes && s.duration_s < VERY_SHORT_S && !busy && (
                      <Badge tone="warning">Very short</Badge>
                    )}
                    {isNotes ? (
                      <NotesStatusBadge status={notesStatus(s, campaign?.jobs ?? [])} className="ml-auto" />
                    ) : (
                      <Badge tone={status.tone} className="ml-auto">
                        {status.label}
                      </Badge>
                    )}
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
              {!busy && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`More for ${sessionTitle(s)}`}
                    className="absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-control bg-surface text-ink-subtle opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 data-[popup-open]:opacity-100"
                  >
                    <Ellipsis className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {unknown.canShift(s.id, 1) && (
                      <DropdownMenuItem icon={<ArrowUp />} onClick={() => unknown.shift(s.id, 1)}>
                        Move later
                      </DropdownMenuItem>
                    )}
                    {unknown.canShift(s.id, -1) && (
                      <DropdownMenuItem icon={<ArrowDown />} onClick={() => unknown.shift(s.id, -1)}>
                        Move earlier
                      </DropdownMenuItem>
                    )}
                    {next && (
                      <DropdownMenuItem
                        icon={<GitMerge />}
                        onClick={() => setPending({ kind: "merge", session: s, with: next.id })}
                      >
                        Merge with next
                      </DropdownMenuItem>
                    )}
                    {previous && (
                      <DropdownMenuItem
                        icon={<GitMerge />}
                        onClick={() => setPending({ kind: "merge", session: s, with: previous.id })}
                      >
                        Merge with previous
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      icon={<Trash2 />}
                      danger
                      onClick={() => setPending({ kind: "delete", ids: [s.id] })}
                    >
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setAddingNotes(true)}
          className="flex cursor-pointer items-center gap-2 rounded-control px-3 py-2.5 text-left text-14 text-ink-subtle hover:bg-elevated hover:text-ink"
        >
          <Plus className="size-4" />
          <NotebookPen className="size-4" />
          Add session notes
        </button>
      </nav>
      <AddNotesDialog open={addingNotes} onOpenChange={setAddingNotes} />
      {pending?.kind === "merge" && (
        <MergeDialog
          key={`${pending.session.id}-${pending.with}`}
          session={pending.session}
          preselect={pending.with}
          open
          onOpenChange={(open) => !open && setPending(null)}
        />
      )}
      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === "delete" && pending.ids.length > 1
            ? "Delete these sessions?"
            : "Delete this session?"
        }
        body="Moves the recording and transcript to the trash. The write-up note in your vault stays."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (pending?.kind !== "delete") return
          await remove(pending.ids)
          setOnlyShort(false)
        }}
      />
    </div>
  )
}
