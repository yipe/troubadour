import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

const dotVariants = cva("inline-block size-[7px] shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-ink-subtle",
      accent: "bg-accent",
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-danger",
      info: "bg-info",
    },
  },
  defaultVariants: { tone: "neutral" },
})

export type StatusDotProps = ComponentProps<"span"> & VariantProps<typeof dotVariants> & { pulse?: boolean }

export function StatusDot({ className, tone, pulse, ...props }: StatusDotProps) {
  return <span className={cn(dotVariants({ tone }), pulse && "animate-speak-pulse", className)} {...props} />
}
