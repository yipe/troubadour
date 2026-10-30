import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Circle, Loader2 } from "lucide-react"
import type { CampaignJob, JobSnippet } from "@troubadour/api/campaign"
import { Progress } from "@troubadour/ui/progress"
import {
  jobActive,
  jobCount,
  jobFraction,
  liveText,
  MARQUEE_MS,
  pickSnippet,
  snippetText,
} from "./progress.ts"

export type JobStatusProps = {
  job: CampaignJob
  variant: "inline" | "panel"
  onDismiss?: () => void
}

/** One job's progress: a line with a bar (inline), or its steps, live model line and finds (panel). */
export function JobStatus({ job, variant, onDismiss }: JobStatusProps) {
  if (job.state === "error") return <JobError job={job} onDismiss={onDismiss} />
  if (!jobActive(job)) return null
  return variant === "inline" ? <Inline job={job} /> : <Panel job={job} />
}

function JobError({ job, onDismiss }: { job: CampaignJob; onDismiss?: () => void }) {
  return (
    <p role="alert" className="text-sm flex items-center gap-2 text-danger">
      <AlertCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{job.message || "Failed"}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-xs rounded px-1.5 py-0.5 hover:bg-elevated">
          Dismiss
        </button>
      )}
    </p>
  )
}

function Inline({ job }: { job: CampaignJob }) {
  const fraction = jobFraction(job)
  const text = job.state === "queued" ? "Waiting for another job…" : job.message || job.title
  return (
    <div className="text-sm flex items-center gap-2 text-ink-muted">
      <Loader2 className="size-4 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">{text}</span>
      {fraction !== null && <Progress value={fraction} className="h-1 w-24 shrink-0" />}
      {fraction !== null ? (
        <span className="tabular-nums">{Math.round(fraction * 100)}%</span>
      ) : (
        <span className="tabular-nums">{jobCount(job)}</span>
      )}
    </div>
  )
}

function Panel({ job }: { job: CampaignJob }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  const reading = job.live?.phase === "reading"
  useEffect(() => {
    if (!reading) return
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [reading])

  const steps = job.steps ?? []
  if (!steps.length) return <Inline job={job} />
  return (
    <ol aria-label="Progress" className="text-sm space-y-1">
      {steps.map((s, i) => (
        <li key={i} data-state={s.state} className="flex flex-col">
          <span
            className={`flex items-center gap-2 ${s.state === "pending" ? "text-ink-subtle" : s.state === "done" ? "text-ink-muted" : "text-ink"}`}
          >
            {s.state === "done" ? (
              <Check className="size-3.5 shrink-0" />
            ) : s.state === "running" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <Circle className="size-3.5 shrink-0" />
            )}
            {s.label}
          </span>
          {s.state === "running" && (job.live || job.message) && (
            <span className="text-xs pl-5.5 text-ink-muted tabular-nums">
              {job.live ? liveText(job.live, now) : job.message}
            </span>
          )}
          {s.state === "running" && job.live?.fraction !== undefined && (
            <Progress value={job.live.fraction} className="mt-1 ml-5.5 h-1 w-48" />
          )}
        </li>
      ))}
      <Marquee snippets={job.snippets ?? []} />
    </ol>
  )
}

/** One find at a time, every few seconds: the model's newest finds first, then the session stats while it reads. */
function Marquee({ snippets }: { snippets: JobSnippet[] }) {
  const [shown, setShown] = useState<{ text: string; n: number } | null>(null)
  const latest = useRef(snippets)
  const seen = useRef(new Set<string>())
  const turn = useRef(0)
  useEffect(() => {
    latest.current = snippets
  }, [snippets])
  const has = snippets.length > 0

  useEffect(() => {
    if (!has) return
    const next = () => {
      const pick = pickSnippet(latest.current, seen.current, turn.current)
      if (!pick) return
      const text = snippetText(pick)
      if (seen.current.has(text) || pick.kind === "stat") turn.current += 1
      else seen.current.add(text)
      setShown((prev) => ({ text, n: (prev?.n ?? 0) + 1 }))
    }
    next()
    const id = setInterval(next, MARQUEE_MS)
    return () => clearInterval(id)
  }, [has])

  if (!shown) return null
  return (
    <li
      key={shown.n}
      data-testid="job-marquee"
      className="animate-in text-xs fade-in list-none pl-5.5 text-ink-muted italic duration-500"
    >
      {shown.text}
    </li>
  )
}
