import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "../lib/cn"

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full bg-line-strong p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-strong data-[checked]:bg-accent-strong data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 rounded-full bg-white transition-transform data-[checked]:translate-x-3.5" />
    </SwitchPrimitive.Root>
  )
}
