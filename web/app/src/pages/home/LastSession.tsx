import { Link } from "react-router"
import { Megaphone, ScrollText } from "lucide-react"
import { useWriteUp } from "@troubadour/api/campaign"
import { useReview } from "@troubadour/api/review"
import type { SavedSession } from "@troubadour/api/sessions"
import type { Player } from "@troubadour/api/players"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { Card } from "@troubadour/ui/card"
import { SectionLabel } from "@troubadour/ui/section-label"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { useJob } from "../../components/jobs/useJob.ts"
import { TalkShareBar } from "../../components/people/TalkShareBar.tsx"
import { dateShort, duration } from "../../lib/format.ts"
import { sessionStatus } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { ReviewBanner } from "./ReviewBanner.tsx"

const titleOf = (s: SavedSession) => s.title?.trim() || `Untitled · ${dateShort(s.started_at)}`

export type LastSessionProps = {
  session: SavedSession | undefined
  /** The session's number, or the number the first one will get. */
  n: number
  writtenUp: boolean
  players: Player[]
}

export function LastSession({ session, n, writtenUp, players }: LastSessionProps) {
  if (!session) {
    return (
      <Card className="flex flex-col gap-3 px-5 py-4">
        <SectionLabel>Last session</SectionLabel>
        <div className="font-serif text-24 font-bold text-ink">No sessions yet</div>
        <p className="text-ink-muted">Record the first one and it shows up here with its write-up.</p>
        <div>
          <Button variant="primary" size="lg" nativeButton={false} render={<Link to={paths.ready()} />}>
            Prepare session {n}
          </Button>
        </div>
      </Card>
    )
  }
  return <Written session={session} n={n} writtenUp={writtenUp} players={players} />
}

function Written({
  session,
  n,
  writtenUp,
  players,
}: Omit<LastSessionProps, "session"> & { session: SavedSession }) {
  const review = useReview(writtenUp ? session.id : null).data
  const writeUp = useWriteUp()
  const { job, active } = useJob("writeup", session.id)
  const status = sessionStatus(session, writtenUp)

  return (
    <>
      <Card className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <SectionLabel>Last session</SectionLabel>
          <Badge tone="accent">Session {n}</Badge>
          <span className="ml-auto text-13 whitespace-nowrap text-ink-subtle">
            {dateShort(session.started_at)} · {duration(session.duration_s)}
          </span>
        </div>
        <h2 className="font-serif text-24 font-bold text-ink">{titleOf(session)}</h2>
        {session.summary ? <p className="text-pretty text-ink-muted">{session.summary}</p> : null}
        {Object.keys(session.talk).length > 0 ? (
          <TalkShareBar talk={session.talk} players={players} height={8} order="share" />
        ) : null}
        <div className="mt-0.5 flex flex-wrap gap-2">
          <Button nativeButton={false} variant="ghost" render={<Link to={paths.transcript(session.id)} />}>
            <ScrollText className="size-3.5" />
            Open transcript
          </Button>
          {writtenUp ? (
            <Button nativeButton={false} variant="ghost" render={<Link to={paths.recap(session.id)} />}>
              <Megaphone className="size-3.5" />
              Previously on… recap
            </Button>
          ) : (
            <Button
              variant="ghost"
              disabled={active || writeUp.isPending}
              onClick={() => writeUp.mutate(session.id)}
            >
              Write up
            </Button>
          )}
        </div>
        {job ? <JobStatus job={job} variant="inline" /> : null}
      </Card>
      {status === "needs-review" && !active && review ? (
        <ReviewBanner sessionId={session.id} n={n} review={review} />
      ) : null}
    </>
  )
}
