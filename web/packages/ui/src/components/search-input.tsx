import { Search, X } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "../lib/cn"
import { Input } from "./input"

export type SearchInputProps = Omit<ComponentProps<"input">, "type"> & { onClear?: () => void }

export function SearchInput({ className, onClear, value, ...props }: SearchInputProps) {
  const showClear = onClear !== undefined && value !== undefined && value !== ""
  return (
    <div className={cn("relative w-full", className)}>
      <Search
        aria-hidden
        className="text-ink-subtle pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      <Input
        type="search"
        value={value}
        className="pl-8 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="text-ink-subtle hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
