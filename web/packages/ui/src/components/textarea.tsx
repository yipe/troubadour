import type { ComponentProps } from "react"
import { cn } from "../lib/cn"
import { inputClass } from "./input"

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "h-auto min-h-16 resize-y py-1.5", className)} {...props} />
}
