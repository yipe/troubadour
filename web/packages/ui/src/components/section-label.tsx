import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function SectionLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("text-12 text-ink-subtle font-bold tracking-[0.08em] uppercase", className)}
      {...props}
    />
  )
}
