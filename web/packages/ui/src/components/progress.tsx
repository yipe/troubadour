import { cn } from "../lib/cn"

const fills = {
  accent: "bg-accent-strong",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
}

export type ProgressProps = { value: number; tone?: keyof typeof fills; className?: string }

export function Progress({ value, tone = "accent", className }: ProgressProps) {
  const clamped = Math.min(1, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("bg-elevated h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div className={cn("h-full rounded-full", fills[tone])} style={{ width: `${clamped * 100}%` }} />
    </div>
  )
}
