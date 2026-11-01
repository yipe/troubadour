import { Checkbox } from "@troubadour/ui/checkbox"
import { Input } from "@troubadour/ui/input"

export type SplitRow = {
  index: number
  n: number | null
  include: boolean
  date: string
  /** No date: its date is unknown and it goes before every dated session. */
  past: boolean
  title: string
  preview: string
}

export type SplitRowsProps = {
  rows: SplitRow[]
  onChange: (rows: SplitRow[]) => void
}

/** The sessions found in a paste: each can be left out, and its date (or "unknown") and title corrected before importing. */
export function SplitRows({ rows, onChange }: SplitRowsProps) {
  const set = (index: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.index === index ? { ...r, ...patch } : r)))
  return (
    <ul aria-label="Sessions found" className="flex flex-col gap-2">
      {rows.map((r) => {
        const label = r.n ? `Session ${r.n}` : `Part ${r.index + 1}`
        return (
          <li key={r.index} className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                aria-label={`Add ${label}`}
                checked={r.include}
                onCheckedChange={(include) => set(r.index, { include: include === true })}
              />
              <span className="w-20 text-13 font-semibold">{label}</span>
              <Input
                type="date"
                aria-label={`${label} date`}
                className="w-40"
                min="1971-01-01"
                max="2100-12-31"
                disabled={r.past}
                value={r.past ? "" : r.date}
                onChange={(e) => set(r.index, { date: e.target.value, past: e.target.value === "" })}
              />
              <label className="flex items-center gap-1.5 text-13 whitespace-nowrap">
                <Checkbox
                  aria-label={`${label} date unknown`}
                  checked={r.past}
                  onCheckedChange={(past) =>
                    set(r.index, { past: past === true, include: past === true || r.date !== "" })
                  }
                />
                Unknown
              </label>
              <Input
                aria-label={`${label} title`}
                className="min-w-40 flex-1"
                maxLength={120}
                placeholder="Title"
                value={r.title}
                onChange={(e) => set(r.index, { title: e.target.value })}
              />
            </div>
            {r.past && !r.date && (
              <p className="text-12 text-ink-subtle">
                No date in the heading, so its date is unknown. Pick a date to place it.
              </p>
            )}
            <p className="truncate text-12 text-ink-subtle">{r.preview}</p>
          </li>
        )
      })}
    </ul>
  )
}
