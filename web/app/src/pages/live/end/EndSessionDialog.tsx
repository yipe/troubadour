import { useState } from "react"
import { Link } from "react-router"
import { useWriteUp } from "@troubadour/api/campaign"
import { useNotebook } from "@troubadour/api/notebook"
import type { Notebook } from "@troubadour/api/notebook"
import { stopSession } from "@troubadour/api/session"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { JobStatus } from "../../../components/jobs/JobStatus.tsx"
import { useJob } from "../../../components/jobs/useJob.ts"
import { hm } from "../../../lib/format.ts"
import { nextSessionNumber } from "../../../lib/sessions.ts"
import { paths } from "../../../paths.ts"

export interface EndSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** What tonight produced, counted from the notebook as it stood when the session ended. */
export function endSummary(seconds: number, notebook: Notebook | undefined): string {
  const facts = (notebook?.items ?? []).filter((i) => i.kind === "fact" && i.status === "kept").length
  const pins = notebook?.pins.length ?? 0
  return `${hm(seconds)} recorded, ${facts} ${facts === 1 ? "fact" : "facts"} kept, ${pins} ${pins === 1 ? "pin" : "pins"}.`
}

interface Saved {
  id: string | null
  number: number
  summary: string
}

/** Confirm, stop and save, then hand the session to the write-up. The session is saved even if the write-up can't start. */
export function EndSessionDialog({ open, onOpenChange }: EndSessionDialogProps) {
  const sessions = useSessions()
  const notebook = useNotebook()
  const writeUp = useWriteUp()
  const [stopping, setStopping] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { job } = useJob("writeup", saved?.id ?? undefined)

  const number = nextSessionNumber(sessions.data ?? [])

  async function end() {
    setError(null)
    setStopping(true)
    // Read before stopping: the notebook and clock reset once the session is over.
    const nb = notebook.data
    try {
      const stopped = await stopSession()
      const id = nb?.session_id ?? null
      setSaved({ id, number, summary: endSummary(stopped.t, nb) })
      if (!id) throw new Error("The session was saved, but its id is unknown.")
      await writeUp.mutateAsync(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStopping(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !stopping && onOpenChange(next)}>
      <DialogContent>
        {saved ? (
          <>
            <DialogHeader title={`Session ${saved.number} saved`} />
            <DialogBody className="flex flex-col gap-3">
              <p>{saved.summary}</p>
              <p className="text-ink-muted">Writing it up now. Review it from Home when it’s done.</p>
              {error ? (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              ) : job ? (
                <JobStatus variant="inline" job={job} />
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button size="lg" nativeButton={false} render={<Link to={paths.home()} />}>
                Go home
              </Button>
              {saved.id && (
                <Button
                  variant="primary"
                  size="lg"
                  nativeButton={false}
                  render={<Link to={paths.session(saved.id)} />}
                >
                  Open the session
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader
              title={`End session ${number}?`}
              description="Recording stops and the session is saved."
            />
            {error && (
              <DialogBody>
                <p role="alert" className="text-danger">
                  {error}
                </p>
              </DialogBody>
            )}
            <DialogFooter>
              <Button size="lg" disabled={stopping} onClick={() => onOpenChange(false)}>
                Keep going
              </Button>
              <Button variant="danger" size="lg" disabled={stopping} onClick={() => void end()}>
                {stopping ? "Saving…" : "End"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
