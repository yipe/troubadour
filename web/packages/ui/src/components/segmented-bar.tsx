import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "../lib/cn"

export type Segment = { value: number; color: string; label: string }

function total(segments: Segment[]) {
  return segments.reduce((sum, s) => sum + s.value, 0)
}

function percent(value: number, sum: number) {
  return Math.round((value / sum) * 100)
}

export type SegmentedBarProps = {
  segments: Segment[]
  height?: number
  gap?: number
  /** Write each label inside its segment: the whole label when it fits, else its first letter. */
  labels?: boolean
  className?: string
}

export function SegmentedBar({
  segments,
  height = 8,
  gap = 2,
  labels = false,
  className,
}: SegmentedBarProps) {
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
          className="relative flex min-w-0 items-center justify-center overflow-hidden rounded-full"
          style={{ width: `${(s.value / sum) * 100}%`, background: s.color }}
        >
          {labels ? <SegmentLabel text={s.label} /> : null}
        </div>
      ))}
    </div>
  )
}

/** The label is measured hidden, at full length, against its segment on every resize. */
function SegmentLabel({ text }: { text: string }) {
  const full = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(false)
  useLayoutEffect(() => {
    const measure = full.current
    const segment = measure?.parentElement
    if (!measure || !segment) return
    const check = () => setFits(measure.offsetWidth > 0 && measure.offsetWidth <= segment.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(segment)
    return () => observer.disconnect()
  }, [text])
  const style =
    "px-1.5 text-11 leading-none font-semibold whitespace-nowrap text-ink-on-accent text-shadow-xs"
  return (
    <>
      <span ref={full} aria-hidden className={cn(style, "invisible absolute")}>
        {text}
      </span>
      <span aria-hidden data-label className={cn(style, "overflow-hidden", !fits && "px-0")}>
        {fits ? text : text.slice(0, 1)}
      </span>
    </>
  )
}

export function SegmentedLegend({ segments, className }: { segments: Segment[]; className?: string }) {
  const sum = total(segments)
  if (sum <= 0) return null
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-muted", className)}>
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
