import { useState } from "react"
import { Link } from "react-router"
import { ScrollText } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useWriteUp } from "@troubadour/api/campaign"
import { useLive } from "@troubadour/api/live"
import { useSessionRecord, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { SectionLabel } from "@troubadour/ui/section-label"
import { TimestampLink } from "../../components/audio/TimestampLink.tsx"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { useJob } from "../../components/jobs/useJob.ts"
import { TalkShareBar } from "../../components/people/TalkShareBar.tsx"
import { dateLong, duration, durationShort, timeRange } from "../../lib/format.ts"
import { sessionStatus } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { StatTile } from "./StatTile.tsx"
import { openSuggestions, sceneLengths, sessionGains, sessionTitle } from "./stats.ts"
import { ExportMenu, ImproveDialog, MergeDialog, QualityDialog, SessionMenu } from "./tools/index.ts"

const QUALITY = {
  good: { label: "Audio quality good", dot: "bg-success" },
  settings: { label: "Audio quality: check the settings", dot: "bg-warning" },
  microphone: { label: "Audio quality: check the microphone", dot: "bg-danger" },
} as const

export type SessionDetailProps = {
  session: SavedSession
  numbers: ReadonlyMap<string, number>
}

export function SessionDetail({ session, numbers }: SessionDetailProps) {
  const campaign = useCampaign().data
  const players = useLive((s) => s.players)
  const record = useSessionRecord(session.id).data
  const writeUp = useWriteUp()
  const { job } = useJob("writeup", session.id)
  const [dialog, setDialog] = useState<"quality" | "improve" | "merge" | null>(null)

  const writtenUp = session.id in (campaign?.written_up ?? {})
  const status = sessionStatus(session, writtenUp)
  const open = openSuggestions(campaign, session.id)
  const gains = sessionGains(campaign, session.id, numbers)
  const fixed = record?.messages.reduce((sum, m) => sum + (m.fixes?.length ?? 0), 0)
  const scenes = session.scenes ?? []
  const lengths = sceneLengths(scenes, session.duration_s)
  const quality = session.quality ? QUALITY[session.quality] : null
  const setOpen = (name: "quality" | "improve" | "merge") => (next: boolean) => setDialog(next ? name : null)

  const stats: [string, string][] = [
    [durationShort(session.duration_s), "Recorded"],
    [session.lines.toLocaleString("en-US"), "Lines"],
    [String(gains.facts), "New facts"],
    [String(gains.entries), "New entries"],
    [fixed === undefined ? "–" : String(fixed), "Names fixed"],
  ]

  return (
    <div className="flex flex-col gap-5 px-5 py-7 md:px-10">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-[16rem] flex-1">
          <div className="text-13 text-ink-subtle">
            {session.n === null ? "Session" : `Session ${session.n}`} · {dateLong(session.started_at)} ·{" "}
            {timeRange(session.started_at, session.started_at + session.duration_s)}
          </div>
          <h1 className="mt-0.5 font-serif text-32 font-bold">{sessionTitle(session)}</h1>
        </div>
        <ExportMenu session={session} />
        <SessionMenu session={session} onMerge={() => setDialog("merge")} />
        <Button size="lg" nativeButton={false} render={<Link to={paths.transcript(session.id)} />}>
          <ScrollText className="size-3.5" />
          Transcript
        </Button>
        {status === "reviewed" ? (
          <Button size="lg" nativeButton={false} render={<Link to={paths.recap(session.id)} />}>
            Recap
          </Button>
        ) : open > 0 ? (
          <Button
            variant="warning"
            size="lg"
            nativeButton={false}
            render={<Link to={paths.review(session.id)} />}
          >
            Review {open} {open === 1 ? "suggestion" : "suggestions"}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stats.map(([value, label]) => (
          <StatTile key={label} value={value} label={label} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <SectionLabel>Recap</SectionLabel>
          {session.summary ? (
            <p className="font-serif text-[17px] leading-[1.6] text-ink-muted">{session.summary}</p>
          ) : (
            <div className="flex flex-col items-start gap-2">
              {!writtenUp && !job && <p className="text-ink-subtle">This session has not been written up.</p>}
              {job && <JobStatus job={job} variant="inline" />}
              {!writtenUp && (
                <Button
                  variant="primary"
                  disabled={writeUp.isPending || job?.state === "queued" || job?.state === "running"}
                  onClick={() => writeUp.mutate(session.id)}
                >
                  Write up
                </Button>
              )}
            </div>
          )}
          <SectionLabel className="mt-2">Who talked</SectionLabel>
          <TalkShareBar talk={session.talk} players={players} />
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>Scenes</SectionLabel>
          {scenes.length === 0 ? (
            <p className="text-ink-subtle">Scenes appear after the write-up.</p>
          ) : (
            <ul className="overflow-hidden rounded-card border border-line">
              {scenes.map((scene, i) => (
                <li
                  key={`${scene.t}-${i}`}
                  className="flex items-center gap-3 border-b border-line bg-surface px-3.5 py-2.5 last:border-b-0"
                >
                  <span className="w-20 shrink-0">
                    <TimestampLink sessionId={session.id} t={scene.t} hasAudio={session.audio} />
                  </span>
                  <span className="flex-1">{scene.title}</span>
                  <span className="text-12 text-ink-subtle">{duration(lengths[i] ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-12 text-ink-subtle">
            {quality && (
              <>
                <button
                  type="button"
                  className="flex items-center gap-2 hover:text-ink"
                  onClick={() => setDialog("quality")}
                >
                  <span className={`size-2 rounded-full ${quality.dot}`} />
                  {quality.label}
                </button>
                <span aria-hidden>·</span>
              </>
            )}
            <Button variant="link" className="text-12 font-normal" onClick={() => setDialog("improve")}>
              Improve transcript
            </Button>
          </div>
        </div>
      </div>
      <QualityDialog session={session} open={dialog === "quality"} onOpenChange={setOpen("quality")} />
      <ImproveDialog session={session} open={dialog === "improve"} onOpenChange={setOpen("improve")} />
      <MergeDialog session={session} open={dialog === "merge"} onOpenChange={setOpen("merge")} />
    </div>
  )
}
