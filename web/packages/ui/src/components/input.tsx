import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "../lib/cn"

export const inputClass =
  "h-8 w-full rounded-control border border-line bg-sunken px-2.5 text-13 text-ink outline-none placeholder:text-ink-subtle focus:border-accent-strong disabled:opacity-50 aria-invalid:border-danger"

export function Input({ className, ...props }: InputPrimitive.Props) {
  return <InputPrimitive className={cn(inputClass, className)} {...props} />
}
