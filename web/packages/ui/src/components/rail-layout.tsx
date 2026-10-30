import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export type RailLayoutProps = {
  rail: ReactNode
  railWidth?: number
  aside?: ReactNode
  asideWidth?: number
  children: ReactNode
  className?: string
}

// Each column scrolls on its own, so the page itself never scrolls.
export function RailLayout({
  rail,
  railWidth = 300,
  aside,
  asideWidth = 300,
  children,
  className,
}: RailLayoutProps) {
  return (
    <div className={cn("flex h-full min-h-0 w-full", className)}>
      <div className="min-h-0 shrink-0 overflow-auto border-r border-line" style={{ width: railWidth }}>
        {rail}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      {aside != null && (
        <div
          className="min-h-0 shrink-0 overflow-auto border-l border-line bg-sunken"
          style={{ width: asideWidth }}
        >
          {aside}
        </div>
      )}
    </div>
  )
}
