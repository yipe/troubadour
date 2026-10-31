import { useState, type CSSProperties, type ReactNode } from "react"
import { cn } from "../lib/cn"

export type RailLayoutProps = {
  rail: ReactNode
  railWidth?: number
  aside?: ReactNode
  asideWidth?: number
  /** Below `md` the rail is a list the reader rarely needs first: it folds behind a button with this label. */
  railToggleLabel?: string
  children: ReactNode
  className?: string
}

// From `lg` up each column scrolls on its own, so the page itself never scrolls. Below that the
// columns stack (the aside under the main column first, then the rail above it) and the page scrolls
// as one.
export function RailLayout({
  rail,
  railWidth = 300,
  aside,
  asideWidth = 300,
  railToggleLabel,
  children,
  className,
}: RailLayoutProps) {
  const [open, setOpen] = useState(false)
  const folds = railToggleLabel != null
  const widths = { "--rail-w": `${railWidth}px`, "--aside-w": `${asideWidth}px` } as CSSProperties
  return (
    <div
      style={widths}
      className={cn(
        "grid w-full grid-cols-1 md:grid-cols-[min(var(--rail-w),40%)_minmax(0,1fr)] lg:h-full lg:min-h-0",
        aside != null
          ? "lg:grid-cols-[var(--rail-w)_minmax(0,1fr)_var(--aside-w)]"
          : "lg:grid-cols-[var(--rail-w)_minmax(0,1fr)]",
        className,
      )}
    >
      {folds && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="cursor-pointer border-b border-line px-5 py-3 text-left text-13 font-semibold text-accent md:hidden"
        >
          {open ? "Hide" : "Show"} {railToggleLabel}
        </button>
      )}
      <div
        data-slot="rail"
        className={cn(
          "border-b border-line md:border-r md:border-b-0 lg:min-h-0 lg:overflow-auto",
          folds && !open && "hidden md:block",
        )}
      >
        {rail}
      </div>
      <div data-slot="main" className="min-w-0 lg:min-h-0 lg:overflow-auto">
        {children}
      </div>
      {aside != null && (
        <div
          data-slot="aside"
          className="border-t border-line bg-sunken md:col-span-2 lg:col-span-1 lg:min-h-0 lg:overflow-auto lg:border-t-0 lg:border-l"
        >
          {aside}
        </div>
      )}
    </div>
  )
}
