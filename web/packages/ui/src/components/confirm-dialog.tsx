import { useState } from "react"
import { cn } from "../lib/cn"
import { Button } from "./button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "./dialog"
import { Spinner } from "./spinner"

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone: "danger" | "primary"
  /** May return a promise: the dialog closes when it resolves and shows the error if it rejects. */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    if (busy) return
    setError(null)
    onOpenChange(next)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md" className="max-w-[460px]">
        <DialogHeader title={title} />
        <DialogBody className="text-ink-muted">
          {body}
          {error ? (
            <p role="alert" className={cn("text-13 text-danger mt-3")}>
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone} disabled={busy} onClick={confirm}>
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
