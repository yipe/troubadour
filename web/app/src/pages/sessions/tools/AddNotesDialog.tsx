import { useState } from "react"
import { useAddNotesSession } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { notify } from "@troubadour/ui/toast"
import { NotesFields } from "./NotesFields.tsx"
import { notesInput, type NotesValues } from "./notesValues.ts"

export type AddNotesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

const blank = (): NotesValues => ({
  date: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD, local time
  past: false,
  title: "",
  text: "",
})

/** A session you only have notes for: it joins the list and the Timeline by its date, and the notes are read into the codex. */
export function AddNotesDialog({ open, onOpenChange }: AddNotesDialogProps) {
  const add = useAddNotesSession()
  const [values, setValues] = useState(blank)

  function change(next: boolean) {
    if (add.isPending) return
    if (!next) add.reset()
    onOpenChange(next)
  }

  function submit() {
    add.mutate(notesInput(values), {
      onSuccess: () => {
        notify("Reading the notes into the codex…")
        setValues((v) => ({ ...v, title: "", text: "" }))
        change(false)
      },
    })
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
            <NotesFields
              values={values}
              onChange={setValues}
              {...(add.error ? { error: add.error.message } : {})}
            />
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
            disabled={(!values.past && !values.date) || !values.text.trim() || add.isPending}
          >
            Add session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
