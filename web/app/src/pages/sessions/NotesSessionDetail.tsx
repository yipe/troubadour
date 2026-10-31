import { useState } from "react"
import { useNavigate } from "react-router"
import { Trash2 } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useSessionNotes, type SavedSession } from "@troubadour/api/sessions"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { SectionHeading } from "@troubadour/ui/section-heading"
import { Spinner } from "@troubadour/ui/spinner"
import { dateLong } from "../../lib/format.ts"
import { paths } from "../../paths.ts"
import { StatTile } from "./StatTile.tsx"
import { sessionGains, sessionTitle } from "./stats.ts"
import { useRemoveSessions } from "./useRemoveSessions.ts"

export type NotesSessionDetailProps = { session: SavedSession; numbers: ReadonlyMap<string, number> }

/** A session known only from imported notes: the notes stand where the recording and transcript would. */
export function NotesSessionDetail({ session, numbers }: NotesSessionDetailProps) {
  const campaign = useCampaign().data
  const notes = useSessionNotes(session.id)
  const remove = useRemoveSessions()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const gains = sessionGains(campaign, session.id, numbers)

  return (
    <div className="flex flex-col gap-5 px-5 py-7 md:px-10">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-[16rem] flex-1">
          <h1 className="font-serif text-32 font-bold text-accent">{sessionTitle(session)}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-13 text-ink-subtle">
            {session.n === null ? "Session" : `Session ${session.n}`} · {dateLong(session.started_at)}
            <Badge>Notes</Badge>
          </div>
        </div>
        <Button size="lg" variant="ghost" aria-label="Delete this session" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
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
