import { useStorage } from "@troubadour/api/storage"
import { SegmentedBar, type Segment } from "@troubadour/ui/segmented-bar"
import { bytes } from "../../../../lib/format.ts"

/** Colours are CSS variables so the bar follows the theme. */
function storageSegments(u: { recordings: number; voices: number; notes: number; other: number }): Segment[] {
  return [
    { label: "Recordings", value: u.recordings, color: "var(--color-accent)" },
    { label: "Voices", value: u.voices, color: "var(--color-very-rare)" },
    { label: "Notes", value: u.notes, color: "var(--color-success)" },
    { label: "Other", value: u.other, color: "var(--color-line-strong)" },
  ]
}

export function StorageBar() {
  const { data } = useStorage()
  if (!data) return null
  const segments = storageSegments(data)
  return (
    <section aria-labelledby="storage-heading">
      <h2 id="storage-heading" className="mb-1 font-serif text-18 font-bold text-ink">
        Storage
      </h2>
      <p className="mb-3 font-mono text-12 text-ink-subtle">{data.root}</p>
      <div className="rounded-card border border-line bg-surface p-3">
        <SegmentedBar segments={segments} />
        <ul className="mt-3 space-y-1 text-13">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-ink-muted">{s.label}</span>
              <span className="font-mono text-ink">{bytes(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
