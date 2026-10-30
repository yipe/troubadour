import { ChevronDown } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/cn"
import { inputClass } from "./input"

export type NativeSelectProps = ComponentProps<"select"> & {
  /** Shown inside the control before the text, e.g. a class colour dot. */
  leading?: ReactNode
}

export function NativeSelect({ className, leading, children, ...props }: NativeSelectProps) {
  return (
    <div className="relative w-full">
      {leading ? (
        <span className="pointer-events-none absolute top-1/2 left-2.5 flex -translate-y-1/2 items-center">
          {leading}
        </span>
      ) : null}
      <select
        className={cn(inputClass, "cursor-pointer appearance-none pr-7", leading && "pl-8", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  )
}
