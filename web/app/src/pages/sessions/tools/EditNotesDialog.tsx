import { useState } from "react"
import { useEditSessionNotes } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { notify } from "@troubadour/ui/toast"
import { NotesFields } from "./NotesFields.tsx"
import { notesInput, type NotesValues } from "./notesValues.ts"

export type EditNotesDialogProps = {
  sessionId: string
  /** What the session has now. Mount the dialog per edit: it starts from this each time. */
  initial: NotesValues
  onClose: () => void
}

/** Change a notes session's date, title or notes. Saving reads the notes into the codex again. */
export function EditNotesDialog({ sessionId, initial, onClose }: EditNotesDialogProps) {
  const edit = useEditSessionNotes(sessionId)
  const [values, setValues] = useState(initial)

  function change(open: boolean) {
    if (!open && !edit.isPending) onClose()
  }

  function submit() {
    edit.mutate(notesInput(values), {
      onSuccess: () => {
        notify("Reading the notes into the codex again…")
        onClose()
      },
    })
  }

  return (
    <Dialog open onOpenChange={change}>
      <DialogContent>
        <DialogHeader
          title="Edit session notes"
          description="Saving reads the notes again: facts the old notes added are removed, and the new notes add theirs. Entries stay."
        />
        <DialogBody>
          <form
            id="edit-notes"
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <NotesFields
              values={values}
              onChange={setValues}
              {...(edit.error ? { error: edit.error.message } : {})}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-notes"
            variant="primary"
            disabled={(!values.past && !values.date) || !values.text.trim() || edit.isPending}
          >
            Save and read again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
