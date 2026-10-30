import { cn } from "../lib/cn"

export type Segment = { value: number; color: string; label: string }

function total(segments: Segment[]) {
  return segments.reduce((sum, s) => sum + s.value, 0)
}

function percent(value: number, sum: number) {
  return Math.round((value / sum) * 100)
}

export type SegmentedBarProps = { segments: Segment[]; height?: number; gap?: number; className?: string }

export function SegmentedBar({ segments, height = 8, gap = 2, className }: SegmentedBarProps) {
  const sum = total(segments)
  if (sum <= 0) return null
  const shown = segments.filter((s) => s.value > 0)
  const label = shown.map((s) => `${s.label} ${percent(s.value, sum)}%`).join(", ")
  return (
    <div role="img" aria-label={label} className={cn("flex w-full", className)} style={{ height, gap }}>
      {shown.map((s) => (
        <div
          key={s.label}
          data-segment={s.label}
          className="rounded-full"
          style={{ width: `${(s.value / sum) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  )
}

export function SegmentedLegend({ segments, className }: { segments: Segment[]; className?: string }) {
  const sum = total(segments)
  if (sum <= 0) return null
  return (
    <ul className={cn("text-12 text-ink-muted flex flex-wrap gap-x-4 gap-y-1", className)}>
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: s.color }} />
          {s.label}
          <span className="text-ink-subtle">{percent(s.value, sum)}%</span>
        </li>
      ))}
    </ul>
  )
}
