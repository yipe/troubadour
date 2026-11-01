import { Checkbox } from "@troubadour/ui/checkbox"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { Textarea } from "@troubadour/ui/textarea"
import type { NotesValues } from "./notesValues.ts"

export type NotesFieldsProps = {
  values: NotesValues
  onChange: (values: NotesValues) => void
  /** The server's reason it refused them. */
  error?: string
  /** The notes split into several sessions, each with its own date: hide the one date. */
  noDate?: boolean
}

/** The date, title and notes of a notes-only session: what you type to add one, and what you change to edit it. */
export function NotesFields({ values, onChange, error, noDate = false }: NotesFieldsProps) {
  return (
    <>
      <div className={`grid gap-3 ${noDate ? "" : "grid-cols-[10rem_1fr]"}`}>
        {!noDate && (
          <Field label="Date">
            <Input
              type="date"
              required={!values.past}
              disabled={values.past}
              min="1971-01-01"
              max="2100-12-31"
              value={values.past ? "" : values.date}
              onChange={(e) => onChange({ ...values, date: e.target.value })}
            />
          </Field>
        )}
        <Field label="Title">
          <Input
            value={values.title}
            maxLength={120}
            placeholder="Optional"
            onChange={(e) => onChange({ ...values, title: e.target.value })}
          />
        </Field>
      </div>
      {!noDate && (
        <label className="flex items-center gap-2 text-13">
          <Checkbox
            checked={values.past}
            onCheckedChange={(past) => onChange({ ...values, past: past === true })}
            aria-label="Date unknown"
          />
          Date unknown: it goes before your dated sessions. Drag it into place in Sessions.
        </label>
      )}
      <Field label="Notes" {...(error ? { error } : {})}>
        <Textarea
          value={values.text}
          onChange={(e) => onChange({ ...values, text: e.target.value })}
          placeholder="Paste or type what happened…"
          className="max-h-[50vh] min-h-48"
        />
      </Field>
    </>
  )
}
