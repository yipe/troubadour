import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export type PageHeadingProps = {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** accent: the title in the accent colour (settings pages). */
  tone?: "default" | "accent"
  className?: string
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  actions,
  tone = "default",
  className,
}: PageHeadingProps) {
  return (
    <header className={cn("flex items-end gap-4", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow != null && <div className="mb-1 font-serif text-13 text-accent">{eyebrow}</div>}
        <h1
          className={cn(
            "font-serif text-34 leading-tight font-bold",
            tone === "accent" ? "text-accent" : "text-ink",
          )}
        >
          {title}
        </h1>
        {subtitle != null && <p className="mt-1 text-14 text-ink-muted">{subtitle}</p>}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
