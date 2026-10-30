import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useCampaign, useImportNotes } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Chip } from "@troubadour/ui/chip"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { Textarea } from "@troubadour/ui/textarea"
import { EntityLink } from "../entity/EntityLink.tsx"
import { JobStatus } from "../jobs/JobStatus.tsx"
import { jobActive } from "../jobs/progress.ts"
import { appendFiles } from "./appendFiles.ts"

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
  const queued = importNotes.data
  const job =
    useCampaign().data?.jobs.find((j) => j.id === jobId) ?? (queued?.id === jobId ? queued : undefined)

  const reset = () => {
    setText("")
    setJobId(null)
    importNotes.reset()
  }

  const submit = () =>
    importNotes.mutate({ title: title.trim() || DEFAULT_TITLE, text }, { onSuccess: (j) => setJobId(j.id) })

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
      {job?.state === "error" && <JobStatus job={job} variant="inline" onDismiss={reset} />}
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
