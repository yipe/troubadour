import { Menu } from "@base-ui/react/menu"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { cn } from "../lib/cn"

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export function DropdownMenuContent({
  className,
  side = "bottom",
  align = "end",
  sideOffset = 6,
  ...props
}: Menu.Popup.Props & Pick<Menu.Positioner.Props, "side" | "align" | "sideOffset">) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <Menu.Popup
          className={cn(
            "rounded-dialog border-popover-line bg-popover shadow-popover min-w-44 border p-1 outline-none",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  )
}

const itemVariants = cva(
  "text-13 flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 outline-none select-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        default: "text-ink data-[highlighted]:bg-elevated",
        danger: "text-danger data-[highlighted]:bg-danger-soft",
      },
    },
    defaultVariants: { tone: "default" },
  },
)

export function DropdownMenuItem({
  icon,
  danger,
  className,
  children,
  ...props
}: Menu.Item.Props & { icon?: ReactNode; danger?: boolean }) {
  return (
    <Menu.Item className={cn(itemVariants({ tone: danger ? "danger" : "default" }), className)} {...props}>
      {icon}
      {children}
    </Menu.Item>
  )
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn("bg-line my-1 h-px", className)} />
}
