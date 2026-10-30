import type { ReactNode } from "react"
import { cn } from "../lib/cn"

const tones = {
  neutral: "bg-elevated text-ink-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
}

export type IconTileProps = {
  tone?: keyof typeof tones
  size?: 28 | 32 | 36
  children: ReactNode
  className?: string
}

export function IconTile({ tone = "neutral", size = 32, children, className }: IconTileProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control",
        tones[tone],
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  )
}
