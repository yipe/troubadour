import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import type { ReactElement, ReactNode } from "react"

export const TooltipProvider = TooltipPrimitive.Provider

/** `children` must be a single element that can hold a ref (it becomes the trigger). */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode
  children: ReactElement
  side?: TooltipPrimitive.Positioner.Props["side"]
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-50">
          <TooltipPrimitive.Popup className="max-w-xs rounded-control border border-popover-line bg-popover px-2.5 py-1.5 text-12 text-ink">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
