import { useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useCampaign, useImportNotes, usePreviewImport } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Checkbox } from "@troubadour/ui/checkbox"
import { Chip } from "@troubadour/ui/chip"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { Textarea } from "@troubadour/ui/textarea"
import { EntityLink } from "../entity/EntityLink.tsx"
import { JobStatus } from "../jobs/JobStatus.tsx"
import { jobActive } from "../jobs/progress.ts"
import { appendFiles } from "./appendFiles.ts"
import { SplitRows, type SplitRow } from "./SplitRows.tsx"

export type ImportNotesProps = { onDone?: () => void }

const DEFAULT_TITLE = "Imported notes"

/** Paste notes or pick Markdown files; the local model reads them into the codex in the background. */
export function ImportNotes({ onDone }: ImportNotesProps) {
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [text, setText] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const importNotes = useImportNotes()
  const preview = usePreviewImport()
  const [rows, setRows] = useState<SplitRow[]>([])
  const [more, setMore] = useState(0) // sessions found beyond what one import takes
  // What comes before the first session heading (a cast list): read as background notes unless unticked.
  const [background, setBackground] = useState<{ chars: number; preview: string } | null>(null)
  const [readBackground, setReadBackground] = useState(true)
  const [onTimeline, setOnTimeline] = useState(true)
  const queued = importNotes.data
  const job =
    useCampaign().data?.jobs.find((j) => j.id === jobId) ?? (queued?.id === jobId ? queued : undefined)

  // Notes with clear session headings can join the Timeline: look for them once typing pauses.
  const { mutate: findSessions } = preview
  useEffect(() => {
    if (!text.trim()) {
      setRows([])
      setMore(0)
      setBackground(null)
      return
    }
    const timer = setTimeout(
      () =>
        findSessions(
          { title: "", text },
          {
            onSuccess: (found) => {
              setMore(found.more)
              setBackground(
                found.background ? { chars: found.background_chars, preview: found.background } : null,
              )
              setRows(
                found.sessions.map((s, index) => ({
                  index,
                  n: s.n,
                  include: true,
                  date: s.date ?? "",
                  past: s.date === null, // no date in the heading: before every dated session
                  title: s.title ?? "",
                  preview: s.preview,
                })),
              )
            },
          },
        ),
      400,
    )
    return () => clearTimeout(timer)
  }, [text, findSessions])

  const dismiss = () => {
    setJobId(null)
    importNotes.reset()
  }
  const reset = () => {
    setText("")
    dismiss()
  }

  const chosen = onTimeline ? rows.filter((r) => r.include && (r.past || r.date)) : []
  const submit = () =>
    importNotes.mutate(
      {
        title: title.trim() || DEFAULT_TITLE,
        text,
        ...(rows.length > 0 && chosen.length > 0
          ? {
              ...(background && readBackground ? { background: true } : {}),
              sessions: chosen.map((r) => ({
                index: r.index,
                date: r.past ? null : r.date,
                title: r.title.trim() || null,
              })),
            }
          : {}),
      },
      { onSuccess: (j) => setJobId(j.id) },
    )

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setFileError(null)
    try {
      const added = await appendFiles(text, Array.from(files))
      setText(added)
    } catch {
      setFileError("Couldn't read one of those files.")
    }
    if (picker.current) picker.current.value = ""
  }

  if (job && !jobActive(job) && job.state === "done") {
    const names = [...job.created, ...job.updated]
    return (
      <div className="flex flex-col gap-3" data-testid="import-summary">
        <p className="text-14 font-medium">
          {job.created.length} new · {job.updated.length} updated
        </p>
        {(names.length > 0 || job.suggested > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {job.created.map((n) => (
              <Chip key={`c-${n}`} tone="success">
                <EntityLink name={n} />
              </Chip>
            ))}
            {job.updated.map((n) => (
              <Chip key={`u-${n}`} tone="info">
                <EntityLink name={n} />
              </Chip>
            ))}
            {job.suggested > 0 && <Chip tone="warning">{job.suggested} suggested to review</Chip>}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset}>
            Import more
          </Button>
          {onDone && (
            <Button variant="primary" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (job && jobActive(job)) return <JobStatus job={job} variant="panel" />

  const error = job?.state === "error" ? undefined : importNotes.error?.message
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Notes" error={error ?? fileError ?? undefined}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your notes here…"
          className="max-h-[50vh] min-h-48 font-mono"
        />
      </Field>
      {rows.length > 0 && (
        <div className="flex flex-col gap-2" data-testid="split-found">
          <p className="text-14 font-medium">Found {rows.length} sessions. They'll appear on the Timeline.</p>
          <label className="flex items-center gap-2 text-13">
            <Checkbox
              checked={onTimeline}
              onCheckedChange={(v) => setOnTimeline(v === true)}
              aria-label="Add them to the Timeline"
            />
            Add them to the Timeline
          </label>
          {more > 0 && (
            <p className="text-13 text-warning">
              {more} more {more === 1 ? "session was" : "sessions were"} found than one import can add. Only
              the first {rows.length} are listed; paste the rest in another import.
            </p>
          )}
          {onTimeline && background && (
            <label className="flex items-start gap-2 text-13">
              <Checkbox
                checked={readBackground}
                onCheckedChange={(v) => setReadBackground(v === true)}
                aria-label="Read what comes before the first session"
              />
              <span>
                Also read the {background.chars.toLocaleString("en-US")} characters before the first session
                as background notes
                <span className="block truncate text-12 text-ink-subtle">{background.preview}</span>
              </span>
            </label>
          )}
          {onTimeline && rows.length > 1 && (
            <Button
              type="button"
              variant="link"
              className="self-start text-13"
              onClick={() => setRows(rows.map((r) => ({ ...r, past: true })))}
            >
              Mark every date unknown
            </Button>
          )}
          {onTimeline && <SplitRows rows={rows} onChange={setRows} />}
        </div>
      )}
      {job?.state === "error" && <JobStatus job={job} variant="inline" onDismiss={dismiss} />}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!text.trim() || importNotes.isPending}>
          <Upload className="size-4" /> Import
        </Button>
        <Button type="button" variant="secondary" onClick={() => picker.current?.click()}>
          Choose .md files
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          data-testid="import-files"
          onChange={(e) => void pickFiles(e.target.files)}
        />
      </div>
    </form>
  )
}
