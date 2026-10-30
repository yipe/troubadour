import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { Check, X } from "lucide-react"
import { cn } from "../lib/cn"

const chipVariants = cva("text-13 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5", {
  variants: {
    tone: {
      neutral: "bg-badge text-badge-ink border-transparent",
      accent: "bg-accent-soft text-accent border-transparent",
      success: "bg-success-soft text-success border-transparent",
      warning: "bg-warning-soft text-warning border-transparent",
      danger: "bg-danger-soft text-danger border-transparent",
      info: "bg-info-soft text-info border-transparent",
    },
    dashed: { true: "bg-transparent border-dashed border-accent-strong text-accent", false: "" },
  },
  defaultVariants: { tone: "neutral", dashed: false },
})

export type ChipProps = {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info"
  /** The pending "heard as" chip: shows accept and reject buttons. */
  dashed?: boolean
  onClick?: () => void
  onRemove?: () => void
  onAccept?: () => void
  onReject?: () => void
  className?: string
  children: ReactNode
}

export function Chip({
  tone,
  dashed,
  onClick,
  onRemove,
  onAccept,
  onReject,
  className,
  children,
}: ChipProps) {
  const classes = cn(chipVariants({ tone, dashed: !!dashed }), className)
  const body = onClick ? (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ) : (
    <span>{children}</span>
  )
  return (
    <span className={classes}>
      {body}
      {dashed && onAccept && (
        <button type="button" aria-label="Accept" onClick={onAccept} className="flex text-success">
          <Check size={13} />
        </button>
      )}
      {dashed && onReject && (
        <button type="button" aria-label="Reject" onClick={onReject} className="flex text-danger">
          <X size={13} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          className="flex opacity-70 hover:opacity-100"
        >
          <X size={13} />
        </button>
      )}
    </span>
  )
}
