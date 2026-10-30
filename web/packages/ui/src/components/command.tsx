import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "../lib/cn"

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn("flex flex-col overflow-hidden rounded-dialog bg-popover text-ink", className)}
      {...props}
    />
  )
}

export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-popover-line px-3">
      <Search className="size-4 shrink-0 text-ink-subtle" />
      <CommandPrimitive.Input
        className={cn("h-10 w-full bg-transparent text-14 text-ink outline-none", className)}
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
      className={cn("py-6 text-center text-13 text-ink-subtle", className)}
      {...props}
    />
  )
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-subtle [&_[cmdk-group-heading]]:uppercase",
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
        "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-13 select-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-elevated [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  )
}
