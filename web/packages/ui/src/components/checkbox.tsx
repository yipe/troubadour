import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import { cn } from "../lib/cn"

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-badge border border-line-strong bg-sunken text-ink-on-accent outline-none focus-visible:ring-2 focus-visible:ring-accent-strong data-[checked]:border-accent-strong data-[checked]:bg-accent-strong data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
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
