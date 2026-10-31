import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AudioLines, Drama, RefreshCw, SpellCheck, Undo2, Wand2 } from "lucide-react"
import type { CampaignJob } from "@troubadour/api/campaign"
import { keys } from "@troubadour/api/query"
import { useLive } from "@troubadour/api/live"
import {
  REFRESH_JOB,
  useCancelRefresh,
  useEstimateInCharacter,
  useFixSpellings,
  useImproveSession,
  useRefreshSession,
  useRestoreSession,
  useRetranscribeSession,
  useSessionRecord,
  type SavedSession,
} from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@troubadour/ui/dialog"
import { JobStatus } from "../../../components/jobs/JobStatus.tsx"
import { useJob } from "../../../components/jobs/useJob.ts"

export type ImproveDialogProps = {
  session: SavedSession
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type Kind = CampaignJob["kind"]

/** The saved record is read-only to the page, so a finished job must refetch it (and the list's flags). */
function useRefreshWhenDone(kind: Kind, sessionId: string) {
  const client = useQueryClient()
  const { job, active } = useJob(kind, sessionId)
  const watched = useRef<string | null>(null)
  useEffect(() => {
    // Only a job seen running here counts as "just finished", not a done job from an earlier visit.
    if (job && active) watched.current = job.id
    else if (job?.state === "done" && watched.current === job.id) {
      watched.current = null
      void client.invalidateQueries({ queryKey: keys.record(sessionId) })
      void client.invalidateQueries({ queryKey: keys.sessions() })
    }
  }, [job, active, client, sessionId])
  return { job, active }
}

export function ImproveDialog({ session, open, onOpenChange }: ImproveDialogProps) {
  const record = useSessionRecord(session.id).data?.session
  const improve = useImproveSession()
  const spelling = useFixSpellings()
  const retranscribe = useRetranscribeSession()
  const inCharacter = useEstimateInCharacter()
  const restore = useRestoreSession()
  const refresh = useRefreshSession()
  const cancel = useCancelRefresh()
  const running = useLive((s) => (s.session?.status ?? "idle") !== "idle")

  const jobs = {
    refresh: useRefreshWhenDone(REFRESH_JOB, session.id),
    improve: useRefreshWhenDone("improve", session.id),
    spelling: useRefreshWhenDone("spelling", session.id),
    retranscribe: useRefreshWhenDone("retranscribe", session.id),
    incharacter: useRefreshWhenDone("incharacter", session.id),
  }
  const anyActive = Object.values(jobs).some((j) => j.active)
  const starting =
    refresh.isPending ||
    improve.isPending ||
    spelling.isPending ||
    retranscribe.isPending ||
    inCharacter.isPending
  const busy = anyActive || starting || restore.isPending
  const [confirm, setConfirm] = useState<"retranscribe" | "restore" | null>(null)

  const done = (n: number, one: string, many: string) =>
    `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
  const percent = record?.in_character
    ? Math.round((record.in_character.in_character / Math.max(1, record.in_character.lines)) * 100)
    : 0
  const restorable = session.restorable || !!(record?.improved || record?.spelling || record?.retranscribed)

  function change(next: boolean) {
    if (!next) setConfirm(null)
    onOpenChange?.(next)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader
          title="Improve transcript"
          description="Each tool keeps the original, so you can always restore it."
        />
        <DialogBody className="flex flex-col divide-y divide-line py-2">
          <ToolRow
            icon={<RefreshCw />}
            title="Refresh this session"
            body="Re-runs everything that can run, in order: listening again, speakers, spellings, talk time, in-character lines, the write-up, the review list and the recap. Steps that can't run here (no recording, not written up yet) are skipped. It can take a long while."
            keeps="Keeps: the original transcript (Restore original), the old write-up page (moved to the vault's trash), the old review list and recap (archived beside the new ones), and every fact you confirmed. New facts arrive as suggestions to review."
            action="Refresh this session"
            primary
            panel
            disabled={busy || running}
            job={jobs.refresh.job}
            onRun={() => refresh.mutate(session.id)}
            onCancel={
              jobs.refresh.job && jobs.refresh.active ? () => cancel.mutate(jobs.refresh.job!.id) : undefined
            }
            error={refresh.error?.message}
            result={jobs.refresh.job?.state === "done" && jobs.refresh.job.message}
          />
          {session.replayable && (
            <ToolRow
              icon={<Wand2 />}
              title="Improve transcript"
              body="Re-transcribe with what the campaign knows now (names, spellings). Takes a few minutes."
              action="Improve"
              disabled={busy}
              job={jobs.improve.job}
              onRun={() => improve.mutate(session.id)}
              error={improve.error?.message}
              result={
                record?.improved && `Improved · ${done(record.improved.changed, "line", "lines")} changed`
              }
            />
          )}
          {session.audio && (
            <ToolRow
              icon={<AudioLines />}
              title="Retranscribe (speakers)"
              body="Re-assign who spoke each line from the recording. The words stay. Lines you corrected by hand can move."
              action="Retranscribe"
              disabled={busy}
              job={jobs.retranscribe.job}
              confirm={
                confirm === "retranscribe" && (
                  <Confirm
                    text="A copy of this transcript is saved first. Speakers you fixed by hand can still move. The words stay."
                    label="Retranscribe anyway"
                    disabled={busy}
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => {
                      setConfirm(null)
                      retranscribe.mutate(session.id)
                    }}
                  />
                )
              }
              onRun={() => setConfirm("retranscribe")}
              error={retranscribe.error?.message}
              result={
                record?.retranscribed && (
                  <>
                    {record.retranscribed.changed} of {record.retranscribed.lines} lines reassigned.
                    {record.retranscribed.heard_next > 0 &&
                      ` ${record.retranscribed.heard_next} were hearing the next person.`}
                    {record.retranscribed.rematch > 0 &&
                      ` ${record.retranscribed.rematch} match someone else on their own audio.`}{" "}
                    Previous copy: {record.retranscribed.backup}
                  </>
                )
              }
            />
          )}
          <ToolRow
            icon={<SpellCheck />}
            title="Fix spellings"
            body="Fix names and D&D terms with the glossary and the local AI. Quick; no re-listening."
            action="Fix spellings"
            disabled={busy}
            job={jobs.spelling.job}
            onRun={() => spelling.mutate(session.id)}
            error={spelling.error?.message}
            result={record?.spelling && `Spellings fixed · ${record.spelling.fixed}`}
          />
          <ToolRow
            icon={<Drama />}
            title="Estimate in-character time"
            body="The AI reads each player's lines (not the GM's) and marks the ones spoken as their character. About one AI call per 25 lines."
            action="Estimate"
            disabled={busy}
            job={jobs.incharacter.job}
            onRun={() => inCharacter.mutate(session.id)}
            error={inCharacter.error?.message}
            result={record?.in_character && `In character · ${percent}% of lines`}
          />
          {restorable && (
            <ToolRow
              icon={<Undo2 />}
              title="Restore original"
              body="Put back the transcript as it was recorded, undoing the tools above."
              action="Restore original"
              disabled={busy}
              confirm={
                confirm === "restore" && (
                  <Confirm
                    text="The improved transcript is replaced by the original."
                    label="Confirm restore"
                    disabled={busy}
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => {
                      setConfirm(null)
                      restore.mutate(session.id)
                    }}
                  />
                )
              }
              onRun={() => setConfirm("restore")}
              error={restore.error?.message}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function ToolRow({
  icon,
  title,
  body,
  keeps,
  action,
  primary,
  panel,
  disabled,
  job,
  onCancel,
  confirm,
  result,
  error,
  onRun,
}: {
  icon: ReactNode
  title: string
  body: string
  /** What the tool leaves alone. */
  keeps?: string
  action: string
  primary?: boolean
  /** Show a running job's steps instead of one line. */
  panel?: boolean
  disabled: boolean
  job?: CampaignJob
  /** Stops a running job before its next step. */
  onCancel?: () => void
  confirm?: ReactNode
  result?: ReactNode
  error?: string
  onRun: () => void
}) {
  return (
    <section className="flex flex-col gap-2 py-4" aria-label={title}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-ink-subtle [&_svg]:size-4">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-13 text-ink-muted">{body}</p>
          {keeps && <p className="text-13 text-ink-muted">{keeps}</p>}
          {result && <p className="text-12 text-ink-subtle">{result}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Stop
            </Button>
          )}
          <Button size="sm" variant={primary ? "primary" : "secondary"} disabled={disabled} onClick={onRun}>
            {action}
          </Button>
        </div>
      </div>
      {confirm}
      {job && <JobStatus job={job} variant={panel ? "panel" : "inline"} />}
      {error && (
        <p role="alert" className="text-13 text-danger">
          {error}
        </p>
      )}
    </section>
  )
}

function Confirm({
  text,
  label,
  disabled,
  onConfirm,
  onCancel,
}: {
  text: string
  label: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="ml-7 flex flex-col gap-2 rounded-card bg-elevated p-3">
      <p className="text-13 text-ink-muted">{text}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={disabled} onClick={onConfirm}>
          {label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
