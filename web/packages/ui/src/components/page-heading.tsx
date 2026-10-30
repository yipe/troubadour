import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export type PageHeadingProps = {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeading({ eyebrow, title, subtitle, actions, className }: PageHeadingProps) {
  return (
    <header className={cn("flex items-end gap-4", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow != null && <div className="text-13 text-accent mb-1 font-serif">{eyebrow}</div>}
        <h1 className="text-34 text-ink font-serif leading-tight font-bold">{title}</h1>
        {subtitle != null && <p className="text-14 text-ink-muted mt-1">{subtitle}</p>}
      </div>
      {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
