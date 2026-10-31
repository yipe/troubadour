import { useState } from "react"
import { useNavigate } from "react-router"
import { useMergeSessions, useSessions, useUnmergeSession, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { cn } from "@troubadour/ui/cn"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { notify } from "@troubadour/ui/toast"
import { dateLong, duration, timeRange } from "../../../lib/format.ts"
import { paths } from "../../../paths.ts"
import { sessionTitle } from "../stats.ts"
import { inOrder, mergeCandidates } from "./merge.ts"

export type MergeDialogProps = {
  session: SavedSession
  /** The session to have picked when the dialog opens (merge from a list row). */
  preselect?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Append the later of two sessions onto the earlier one, then open the one that remains. */
export function MergeDialog({ session, preselect, open, onOpenChange }: MergeDialogProps) {
  const sessions = useSessions().data
  const merge = useMergeSessions()
  const unmerge = useUnmergeSession()
  const navigate = useNavigate()
  const [pickedId, setPickedId] = useState<string | null>(preselect ?? null)
  const [confirming, setConfirming] = useState(false)

  const candidates = mergeCandidates(sessions ?? [], session)
  const picked = candidates.find((c) => c.session.id === pickedId)?.session
  const [earlier, later] = picked ? inOrder(session, picked) : [null, null]

  function change(next: boolean) {
    if (merge.isPending) return
    if (!next) {
      setPickedId(preselect ?? null)
      setConfirming(false)
      merge.reset()
    }
    onOpenChange?.(next)
  }

  function run() {
    if (!earlier || !later) return
    merge.mutate([earlier.id, later.id], {
      onSuccess: (kept) => {
        change(false)
        notify("Sessions merged", {
          undo: () => unmerge.mutate(kept.id, { onError: (e) => notify(e.message, { tone: "danger" }) }),
          duration: 8000,
        })
        void navigate(paths.session(kept.id))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader
          title="Merge with another session"
          description="Pick the session to join. The later one is added onto the earlier one."
        />
        <DialogBody className="flex flex-col gap-2">
          {sessions === undefined ? (
            <p className="text-ink-subtle">Loading sessions…</p>
          ) : candidates.length === 0 ? (
            <p className="text-ink-subtle">There are no other saved sessions to merge with.</p>
          ) : (
            <ul aria-label="Sessions" className="flex flex-col gap-1.5">
              {candidates.map(({ session: s, suggested }) => (
                <li key={s.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-card border px-3 py-2",
                      s.id === pickedId ? "border-accent bg-accent-soft" : "border-line bg-surface",
                    )}
                  >
                    <input
                      type="radio"
                      name="merge-with"
                      className="accent-accent"
                      checked={s.id === pickedId}
                      disabled={merge.isPending}
                      onChange={() => {
                        setPickedId(s.id)
                        setConfirming(false)
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {s.n === null ? "Session" : `Session ${s.n}`} · {sessionTitle(s)}
                      </span>
                      <span className="text-12 text-ink-subtle">
                        {dateLong(s.started_at)} · {timeRange(s.started_at, s.started_at + s.duration_s)} ·{" "}
                        {duration(s.duration_s)}
                      </span>
                    </span>
                    {suggested && (
                      <span className="shrink-0 text-12 text-accent">Looks like the same sitting</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {confirming && earlier && later && (
            <p className="mt-1 text-13 text-ink-muted">
              {sessionTitle(later)} is appended onto {sessionTitle(earlier)}, and the later session is moved
              to the trash. You can undo this right after.
            </p>
          )}
          {merge.error && (
            <p role="alert" className="text-13 text-danger">
              {merge.error.message}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={merge.isPending} onClick={() => change(false)}>
            Cancel
          </Button>
          {confirming ? (
            <Button variant="danger" disabled={merge.isPending} onClick={run}>
              Merge sessions
            </Button>
          ) : (
            <Button variant="primary" disabled={!picked} onClick={() => setConfirming(true)}>
              Merge…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
