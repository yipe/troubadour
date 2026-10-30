import { Loader } from "lucide-react"
import { cn } from "../lib/cn"

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin text-ink-subtle", className)}
    />
  )
}
