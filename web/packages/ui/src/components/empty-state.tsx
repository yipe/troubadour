import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export type EmptyStateProps = {
  icon?: ReactNode
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}>
      {icon != null && <div className="flex text-ink-subtle">{icon}</div>}
      <h3 className="font-serif text-16 font-bold text-ink">{title}</h3>
      {body != null && <p className="max-w-sm text-14 text-ink-muted">{body}</p>}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  )
}
