import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Circle, Loader2, X } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { jobActive, jobCount } from "@/lib/campaign"
import { campaignActions } from "@/lib/campaignStore"
import type { CampaignJob, JobLive, JobSnippet } from "@/lib/types"

/** Compact header chip for a queued/running job, or a failed one (dismissible). */
export function JobChip({ job: j }: { job: CampaignJob }) {
  const label =
    j.kind === "writeup"
      ? `Write-up ${j.title}`
      : j.kind === "improve"
        ? `Improve ${j.title}`
        : j.kind === "spelling"
          ? `Spellings ${j.title}`
          : j.kind === "retranscribe"
            ? `Retranscribe ${j.title}`
            : j.kind === "backup"
              ? "Cloud backup"
              : j.kind === "restore"
                ? "Restore from Troubadour Cloud"
                : j.kind === "clone"
                  ? `Voice clone: ${j.title}`
                  : j.kind === "say"
                    ? `Speaking as ${j.title}`
                    : j.kind === "read"
                      ? `Reading ${j.title} aloud`
                      : j.kind === "profile"
                        ? `Speech profile: ${j.title}`
                        : j.kind === "incharacter"
                          ? `In-character time ${j.title}`
                          : j.title || "Import"
  if (j.state === "error")
    return (
      <span
        role="alert"
        data-job={j.id}
        className="inline-flex max-w-80 items-center gap-1.5 rounded-full bg-destructive/15 py-0.5 pr-1 pl-2 text-xs text-destructive"
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span className="truncate">
          {label}: {j.message || "failed"}
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          className="rounded-full p-0.5 hover:bg-destructive/20"
          onClick={() => campaignActions.dismissJob(j.id)}
        >
          <X className="size-3" />
        </button>
      </span>
    )
  return (
    <span
      data-job={j.id}
      className="inline-flex max-w-80 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span className="truncate">
        {label}
        {j.state === "queued" ? " · queued" : ""} {jobCount(j)}
        {j.message ? ` · ${j.message}` : ""}
        {j.live && j.live.phase !== "reading" ? ` · ${j.live.tok_s} tok/s` : ""}
      </span>
    </span>
  )
}

/** Full-width progress for a job (used in the import dialog). */
export function JobBar({ job: j }: { job: CampaignJob }) {
  const pct = j.total > 0 ? (j.done / j.total) * 100 : null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="flex-1 truncate">
          {j.state === "queued" ? "Waiting for the AI…" : j.message || "Reading…"}
        </span>
        <span className="tabular-nums">{jobCount(j)}</span>
      </div>
      <Progress value={pct} />
    </div>
  )
}

/**
 * A job's state as one line under the control that started it: while it runs, what it's doing and how
 * far (unless the control already shows that: `progress={false}`); if it failed, why. Nothing once done.
 */
export function JobStatus({
  job: j,
  working,
  failed,
  progress = true,
}: {
  job: CampaignJob | undefined
  working: string
  failed: string
  progress?: boolean
}) {
  if (j && progress && jobActive(j))
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        {j.state === "queued" ? "Waiting for another job…" : j.message || working} {jobCount(j)}
      </p>
    )
  if (j?.state === "error")
    return (
      <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
        <AlertCircle className="size-3.5 shrink-0" /> {j.message || failed}
      </p>
    )
  return null
}

/** What a streaming model call is doing, e.g. "Writing… ~1,234 tokens · 27 tok/s". */
function liveText(live: JobLive, now: number): string {
  if (live.phase === "reading")
    return `Reading the transcript… ${Math.max(0, Math.round(now - live.started))} s`
  const what = live.phase === "thinking" ? "Thinking" : "Writing"
  return `${what}… ~${live.tokens.toLocaleString("en-US")} tokens · ${live.tok_s} tok/s`
}

/** A staged job's checklist while it runs: done, running (with the model's live progress), still to come. */
export function JobSteps({ job: j }: { job: CampaignJob | undefined }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  const reading = j?.live?.phase === "reading"
  useEffect(() => {
    if (!reading) return
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [reading])
  if (!j || !jobActive(j) || !j.steps?.length) return null
  return (
    <ol aria-label="Write-up progress" className="space-y-1 text-sm">
      {j.steps.map((s, i) => (
        <li key={i} data-state={s.state} className="flex flex-col">
          <span
            className={`flex items-center gap-2 ${s.state === "pending" ? "text-muted-foreground/60" : s.state === "done" ? "text-muted-foreground" : ""}`}
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
          {s.state === "running" && (j.live || j.message) && (
            <span className="pl-5.5 text-xs text-muted-foreground tabular-nums">
              {j.live ? liveText(j.live, now) : j.message}
            </span>
          )}
        </li>
      ))}
      <JobMarquee snippets={j.snippets ?? []} />
    </ol>
  )
}

const MARQUEE_MS = 4000
const PREFIX: Record<JobSnippet["kind"], string> = {
  stat: "",
  beat: "Noted",
  person: "Met",
  place: "Place",
  loot: "Loot",
  character: "",
}

function snippetText(s: JobSnippet): string {
  return [PREFIX[s.kind], s.at, s.text].filter(Boolean).join(" · ")
}

/** One find at a time, every few seconds: the model's newest finds first, as it writes them; while it has
 * nothing new (it is still reading the transcript), the code-counted stats about the session instead. */
export function JobMarquee({ snippets }: { snippets: JobSnippet[] }) {
  const [shown, setShown] = useState<{ snippet: JobSnippet; n: number } | null>(null)
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
      const all = latest.current
      const found = all.filter((s) => s.kind !== "stat")
      const fresh = found.find((s) => !seen.current.has(snippetText(s)))
      const fill = all.filter((s) => s.kind === "stat")
      const pool = fill.length ? fill : found
      const pick = fresh ?? pool[turn.current % pool.length]
      if (fresh) seen.current.add(snippetText(fresh))
      else turn.current += 1
      setShown((prev) => ({ snippet: pick, n: (prev?.n ?? 0) + 1 }))
    }
    next()
    const id = setInterval(next, MARQUEE_MS)
    return () => clearInterval(id)
  }, [has])

  if (!shown) return null
  return (
    <li
      key={shown.n}
      data-testid="write-up-marquee"
      className="animate-in list-none pl-5.5 text-xs text-muted-foreground italic duration-500 fade-in"
    >
      {snippetText(shown.snippet)}
    </li>
  )
}
