import { useState } from "react"
import { useAddNotesSession } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { Textarea } from "@troubadour/ui/textarea"
import { notify } from "@troubadour/ui/toast"

export type AddNotesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

const today = () => new Date().toLocaleDateString("en-CA") // YYYY-MM-DD, local time

/** A session you only have notes for: it joins the list and the Timeline by its date, and the notes are read into the codex. */
export function AddNotesDialog({ open, onOpenChange }: AddNotesDialogProps) {
  const add = useAddNotesSession()
  const [date, setDate] = useState(today)
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")

  function change(next: boolean) {
    if (add.isPending) return
    if (!next) add.reset()
    onOpenChange(next)
  }

  function submit() {
    add.mutate(
      { date, title: title.trim(), text },
      {
        onSuccess: () => {
          notify("Reading the notes into the codex…")
          setTitle("")
          setText("")
          change(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader
          title="Add session notes"
          description="For a session you didn't record. It is listed by its date, and the notes are read into the codex."
        />
        <DialogBody>
          <form
            id="add-notes"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="grid grid-cols-[10rem_1fr] gap-3">
              <Field label="Date">
                <Input
                  type="date"
                  required
                  min="1970-01-01"
                  max="2100-12-31"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Title">
                <Input
                  value={title}
                  maxLength={120}
                  placeholder="Optional"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Notes" {...(add.error ? { error: add.error.message } : {})}>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste or type what happened…"
                className="max-h-[50vh] min-h-48"
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-notes"
            variant="primary"
            disabled={!date || !text.trim() || add.isPending}
          >
            Add session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
