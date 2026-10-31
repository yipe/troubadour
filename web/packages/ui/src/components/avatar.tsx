import type { CSSProperties } from "react"
import { cn } from "../lib/cn"

const sizes = {
  24: "size-6 text-11",
  30: "size-[30px] text-12",
  36: "size-9 text-14",
  44: "size-11 text-16",
} as const

export type AvatarProps = {
  initials: string
  /** Any CSS colour value, e.g. `var(--color-class-bard)`. */
  color: string
  size?: keyof typeof sizes
  src?: string
  className?: string
}

export function Avatar({ initials, color, size = 30, src, className }: AvatarProps) {
  return (
    <span
      style={{ "--avatar": color } as CSSProperties}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-(--avatar)",
        "bg-[color-mix(in_oklch,var(--avatar)_22%,transparent)] shadow-[inset_0_0_0_1.5px_var(--avatar)]",
        sizes[size],
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials}
    </span>
  )
}
