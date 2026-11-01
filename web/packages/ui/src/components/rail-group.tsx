import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { Badge } from "./badge"
import { SectionLabel } from "./section-label"

export type RailGroupProps = {
  label: ReactNode
  /** How many items it holds: shown while it is closed. */
  count?: number
  defaultOpen?: boolean
  className?: string
  children: ReactNode
}

/**
 * A titled group in a rail that can be closed with its disclosure triangle. A native <details>, so it works
 * without script (the website renders its rails on the server) and keeps its state while the page beside it
 * changes.
 */
export function RailGroup({ label, count, defaultOpen = true, className, children }: RailGroupProps) {
  return (
    <details open={defaultOpen} className={cn("group/rail-group", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-control px-3 pt-2 pb-1 select-none hover:bg-elevated [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-ink-subtle transition-transform group-open/rail-group:rotate-90"
        />
        <SectionLabel>{label}</SectionLabel>
        {count !== undefined && (
          <Badge className="ml-auto group-open/rail-group:hidden" aria-label={`${count} inside`}>
            {count}
          </Badge>
        )}
      </summary>
      <div className="flex flex-col gap-0.5">{children}</div>
    </details>
  )
}
