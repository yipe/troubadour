import { useState } from "react"
import { Chip } from "@troubadour/ui/chip"
import { Input } from "@troubadour/ui/input"

const hasCI = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase())

/** Editable list of short strings. Enter, comma or leaving the box adds; duplicates (any case) are ignored. */
export function ChipEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const v = draft.trim()
    setDraft("")
    if (v && !hasCI(values, v)) onChange([...values, v])
  }
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {values.map((v) => (
        <Chip key={v} onRemove={() => onChange(values.filter((x) => x !== v))}>
          {v}
        </Chip>
      ))}
      <Input
        aria-label={`Add ${label}`}
        value={draft}
        placeholder={placeholder}
        className="h-7 w-40"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
  )
}
