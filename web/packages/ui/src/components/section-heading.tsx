import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

/** A section's title inside a page: the serif face of the page title, in the accent colour, one step down. */
export function SectionHeading({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("font-serif text-20 leading-tight font-bold text-accent", className)} {...props} />
}
