import type { ReactNode } from "react"
import { cn } from "../lib/cn"

/** A round icon button on the right of the top bar (theme, account), 30px like the avatar it may hold. */
export const topBarButton =
  "flex size-[30px] cursor-pointer items-center justify-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"

/**
 * The header across the top of every page, in the app and on the cloud website. The page fills it: brand,
 * campaign, tabs, then a spacer and the corner buttons. `className` sets where it stops wrapping.
 */
export function TopBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <header
      className={cn(
        "flex min-h-14 shrink-0 flex-wrap items-center gap-x-5 border-b border-line bg-surface px-4 py-2 whitespace-nowrap",
        className,
      )}
    >
      {children}
    </header>
  )
}
