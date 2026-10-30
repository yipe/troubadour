import { useEffect, useState } from "react"
import { AudioWaveform, Loader2, Mic } from "lucide-react"
import { liveActions, useLive, useLiveStore } from "@troubadour/api/live"
import { useCancelTraining, useTrainPlayer, type Player } from "@troubadour/api/players"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Progress } from "@troubadour/ui/progress"
import { notify } from "@troubadour/ui/toast"

const SECONDS = 20

/** Driven only by `train.status` events and `session.training`; the POST response is just an ack. */
export function TrainDialog({
  player,
  open,
  onOpenChange,
}: {
  player: Player
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const status = useLive((s) => s.train[player.id])
  const serverError = useLive((s) => s.session?.error ?? null)
  const [started, setStarted] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const train = useTrainPlayer()
  const cancel = useCancelTraining()

  const inFlight =
    started && !requestError && (!status || status.state === "recording" || status.state === "processing")

  const start = () => {
    liveActions.clearTrain(player.id)
    setRequestError(null)
    setStarted(true)
    train.mutate({ id: player.id, seconds: SECONDS }, { onError: (e) => setRequestError(e.message) })
  }

  const reset = () => {
    liveActions.clearTrain(player.id)
    setRequestError(null)
    setStarted(false)
  }

  const close = (next: boolean) => {
    if (!next && inFlight) cancel.mutate(undefined, { onError: (e) => notify(e.message, { tone: "danger" }) })
    onOpenChange(next)
  }

  useEffect(() => {
    if (started && status?.state === "done") {
      notify(`${player.name}'s voice is trained`)
      onOpenChange(false)
    }
  }, [started, status?.state, player.name, onOpenChange])

  // If a snapshot says nobody is training while we still show progress, the terminal event was
  // lost (e.g. during a reconnect): go back to the start state.
  useEffect(
    () =>
      useLiveStore.subscribe((s, prev) => {
        if (s.session === prev.session || s.session?.training) return
        const st = s.train[player.id]?.state
        if (st === "recording" || st === "processing" || st === "cancelled") {
          liveActions.clearTrain(player.id)
          setStarted(false)
        }
      }),
    [player.id],
  )

  const cancelled = status?.state === "cancelled"
  const error = started
    ? (requestError ?? (status?.state === "error" ? (status.message ?? "Training failed") : null))
    : null
  const showStart = !started || cancelled
  const secondsLeft = status?.seconds_left ?? SECONDS
  const progress = Math.min(1, Math.max(0, (SECONDS - secondsLeft) / SECONDS))
  const level = Math.min(1, Math.max(0, status?.level ?? 0))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader
          icon={<AudioWaveform />}
          title={showStart ? `Train ${player.name}'s voice` : `Training ${player.name}`}
          description={
            showStart
              ? `Optional: ${SECONDS} seconds of ${player.name} talking helps Troubadour recognise them. Press Start when ready.`
              : `Only ${player.name} talks now. Say anything, e.g. introduce your character.`
          }
        />
        <DialogBody>
          {showStart ? (
            serverError && (
              <p className="rounded-control bg-danger-soft p-3 text-13 text-danger">{serverError}</p>
            )
          ) : error ? (
            <p className="rounded-control bg-danger-soft p-3 text-13 text-danger">{error}</p>
          ) : status?.state === "processing" ? (
            <div className="flex items-center gap-2 py-4 text-ink-muted">
              <Loader2 className="size-4 animate-spin" /> Processing…
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="relative flex size-14 items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full bg-accent-soft transition-transform duration-100"
                    style={{ transform: `scale(${0.6 + level * 0.8})` }}
                  />
                  <Mic className="relative size-6" />
                </div>
                <div className="flex-1">
                  <div className="text-3xl font-semibold tabular-nums">{Math.ceil(secondsLeft)}s</div>
                  <div className="text-12 text-ink-subtle">{status ? "Listening…" : "Starting…"}</div>
                </div>
              </div>
              <Progress value={progress} />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {showStart && (
            <Button variant="primary" disabled={!!serverError} onClick={start}>
              <Mic className="size-4" /> Start
            </Button>
          )}
          {error && (
            <Button variant="primary" disabled={!!serverError} onClick={reset}>
              Try again
            </Button>
          )}
          <Button onClick={() => close(false)}>{error ? "Close" : "Cancel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
