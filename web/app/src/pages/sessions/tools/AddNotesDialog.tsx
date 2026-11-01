import { useState } from "react"
import { useAddNotesSession, useImportNotes } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { notify } from "@troubadour/ui/toast"
import { SplitPreview } from "../../../components/import-notes/SplitPreview.tsx"
import { useSessionSplit } from "../../../components/import-notes/useSessionSplit.ts"
import { NotesFields } from "./NotesFields.tsx"
import { notesInput, type NotesValues } from "./notesValues.ts"

export type AddNotesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void }

const blank = (): NotesValues => ({
  date: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD, local time
  past: false,
  title: "",
  text: "",
})

/**
 * Sessions you only have notes for: they join the list and the Timeline by their dates, and the notes are
 * read into the codex. Notes with several session headings ("Session 1", "Session IV", dates) become one
 * session each.
 */
export function AddNotesDialog({ open, onOpenChange }: AddNotesDialogProps) {
  const add = useAddNotesSession()
  const importNotes = useImportNotes()
  const [values, setValues] = useState(blank)
  const split = useSessionSplit(values.text)
  const splitting = split.rows.length > 0
  const count = split.count
  const pending = add.isPending || importNotes.isPending
  const error = (splitting ? importNotes.error : add.error)?.message

  function change(next: boolean) {
    if (pending) return
    if (!next) {
      add.reset()
      importNotes.reset()
    }
    onOpenChange(next)
  }

  const done = () => {
    notify("Reading the notes into the codex…")
    setValues((v) => ({ ...v, title: "", text: "" }))
    change(false)
  }

  function submit() {
    if (splitting)
      importNotes.mutate(
        { title: values.title.trim() || "Session notes", text: values.text, ...split.request },
        { onSuccess: done },
      )
    else add.mutate(notesInput(values), { onSuccess: done })
  }

  const ready = splitting ? count > 0 : (values.past || values.date !== "") && values.text.trim() !== ""
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader
          title="Add session notes"
          description="For sessions you didn't record. Paste one session, or many with headings like “Session 3” or a date: each becomes its own session, and the notes are read into the codex."
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
              noDate={splitting}
              {...(error ? { error } : {})}
            />
            {splitting && (
              <div className="flex flex-col gap-2" data-testid="split-found">
                <p className="text-14 font-medium">
                  Found {split.rows.length} sessions. Set each one&apos;s date below.
                </p>
                <SplitPreview split={split} />
              </div>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-notes" variant="primary" disabled={!ready || pending}>
            {splitting ? `Add ${count} ${count === 1 ? "session" : "sessions"}` : "Add session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
