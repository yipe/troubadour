import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function SectionLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("text-12 font-bold tracking-[0.08em] text-ink-subtle uppercase", className)}
      {...props}
    />
  )
}
