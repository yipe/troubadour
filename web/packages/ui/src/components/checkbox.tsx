import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import { cn } from "../lib/cn"

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "border-line-strong bg-sunken data-[checked]:border-accent-strong data-[checked]:bg-accent-strong rounded-badge text-ink-on-accent focus-visible:ring-accent-strong flex size-4 shrink-0 cursor-pointer items-center justify-center border outline-none focus-visible:ring-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
