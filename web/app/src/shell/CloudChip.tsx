import { Cloud } from "lucide-react"

/** Placeholder at the final size; S12 shows the backup state. */
export function CloudChip() {
  return (
    <button
      type="button"
      aria-label="Cloud backup"
      className="flex h-[30px] items-center gap-1.5 rounded-control border border-line px-2.5 text-12 font-semibold text-ink-muted"
    >
      <Cloud size={14} />
    </button>
  )
}
