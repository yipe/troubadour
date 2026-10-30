import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/cn"

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border-line bg-surface border", className)} {...props} />
}

export type CardHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
}

export function CardHeader({ title, meta, action, className, ...props }: CardHeaderProps) {
  return (
    <div className={cn("border-line flex items-center gap-3 border-b px-4 py-3", className)} {...props}>
      <h3 className="text-16 text-ink font-serif font-bold">{title}</h3>
      {meta != null && <span className="text-13 text-ink-subtle">{meta}</span>}
      {action != null && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />
}
