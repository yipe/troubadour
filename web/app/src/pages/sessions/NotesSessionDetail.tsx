import { useState } from "react"
import { useNavigate } from "react-router"
import { Clock, Pencil, Trash2 } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useEditSessionNotes, useSessionNotes, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { SectionHeading } from "@troubadour/ui/section-heading"
import { Spinner } from "@troubadour/ui/spinner"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { dateLong, isPast } from "../../lib/format.ts"
import { paths } from "../../paths.ts"
import { notesStatus } from "./notesStatus.ts"
import { NotesStatusBadge } from "./NotesStatusBadge.tsx"
import { StatTile } from "./StatTile.tsx"
import { sessionGains, sessionTitle } from "./stats.ts"
import { EditNotesDialog } from "./tools/index.ts"
import { notesInput, type NotesValues } from "./tools/notesValues.ts"
import { useRemoveSessions } from "./useRemoveSessions.ts"

export type NotesSessionDetailProps = { session: SavedSession; numbers: ReadonlyMap<string, number> }

/** A session known only from imported notes: the notes stand where the recording and transcript would. */
export function NotesSessionDetail({ session, numbers }: NotesSessionDetailProps) {
  const campaign = useCampaign().data
  const notes = useSessionNotes(session.id)
  const reread = useEditSessionNotes(session.id)
  const remove = useRemoveSessions()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const gains = sessionGains(campaign, session.id, numbers)
  const status = notesStatus(session, campaign?.jobs ?? [])
  const waiting = status.state === "queued" || status.state === "reading"
  const current: NotesValues | undefined = notes.data && {
    date: new Date(session.started_at * 1000).toLocaleDateString("en-CA"), // YYYY-MM-DD, local time
    past: isPast(session.started_at),
    title: session.title ?? "",
    text: notes.data.text,
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-7 md:px-10">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-[16rem] flex-1">
          <h1 className="font-serif text-32 font-bold text-accent">{sessionTitle(session)}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-13 text-ink-subtle">
            {session.n === null ? "Session" : `Session ${session.n}`} · {dateLong(session.started_at)}
            <NotesStatusBadge status={status} />
          </div>
        </div>
        <Button
          size="lg"
          variant="ghost"
          aria-label="Edit these notes"
          disabled={waiting || !current}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button size="lg" variant="ghost" aria-label="Delete this session" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      {status.state === "reading" && <JobStatus job={status.job} variant="inline" />}
      {status.state === "queued" && (
        <p className="text-sm flex items-center gap-2 text-ink-muted">
          <Clock className="size-4 shrink-0" /> Waiting its turn to be read into the codex.
        </p>
      )}
      {status.state === "unread" && (
        <div className="text-sm flex flex-wrap items-center gap-3 rounded-card border border-line bg-warning-soft px-4 py-3">
          <span className="min-w-0 flex-1">
            These notes aren't in the codex yet: reading them stopped before it finished.
          </span>
          <Button
            disabled={!current || reread.isPending}
            onClick={() => current && reread.mutate(notesInput(current))}
          >
            Read again
          </Button>
          {reread.error && <span className="w-full text-danger">{reread.error.message}</span>}
        </div>
      )}
      <div className="grid max-w-md grid-cols-2 gap-3">
        <StatTile value={String(gains.facts)} label="New facts" />
        <StatTile value={String(gains.entries)} label="New entries" />
      </div>
      <section aria-label="Notes" className="flex max-w-3xl flex-col gap-3">
        <SectionHeading>Notes</SectionHeading>
        {notes.isError ? (
          <p className="text-ink-subtle">The notes page couldn't be read.</p>
        ) : notes.data ? (
          <p className="font-serif text-[17px] leading-[1.6] whitespace-pre-wrap text-ink-muted">
            {notes.data.text}
          </p>
        ) : (
          <Spinner />
        )}
      </section>
      {editing && current && (
        <EditNotesDialog sessionId={session.id} initial={current} onClose={() => setEditing(false)} />
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this session?"
        body="Takes it off the list and the Timeline. The notes page in your vault stays."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          await remove([session.id])
          void navigate(paths.sessions())
        }}
      />
    </div>
  )
}
