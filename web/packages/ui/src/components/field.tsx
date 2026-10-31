import { cloneElement, useId, type ReactElement } from "react"
import { cn } from "../lib/cn"

export type FieldProps = {
  label: string
  /** One control; Field gives it the id, `aria-describedby` and `aria-invalid`. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>
  hint?: string
  error?: string
  className?: string
}

export function Field({ label, children, hint, error, className }: FieldProps) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error ?? hint
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-12 text-ink-subtle">
        {label}
      </label>
      {cloneElement(children, {
        id,
        "aria-describedby": note ? noteId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {note ? (
        <p id={noteId} className={cn("text-12", error ? "text-danger" : "text-ink-subtle")}>
          {note}
        </p>
      ) : null}
    </div>
  )
}
