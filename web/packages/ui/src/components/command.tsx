import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn("text-ink rounded-dialog bg-popover flex flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="border-popover-line flex items-center gap-2 border-b px-3">
      <Search className="text-ink-subtle size-4 shrink-0" />
      <CommandPrimitive.Input
        className={cn("text-14 text-ink h-10 w-full bg-transparent outline-none", className)}
        {...props}
      />
    </div>
  )
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-72 overflow-y-auto p-1", className)} {...props} />
}

export function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("text-13 text-ink-subtle py-6 text-center", className)}
      {...props}
    />
  )
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "text-13 rounded-control data-[selected=true]:bg-elevated flex cursor-pointer items-center gap-2 px-2 py-1.5 select-none data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}
