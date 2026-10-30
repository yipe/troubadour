import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/cn"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

const contentVariants = cva(
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog border border-line bg-surface shadow-popover outline-none",
  {
    variants: { size: { md: "max-w-[640px]", lg: "max-w-[900px]" } },
    defaultVariants: { size: "md" },
  },
)

export type DialogContentProps = DialogPrimitive.Popup.Props & VariantProps<typeof contentVariants>

export function DialogContent({ className, size, children, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,11,16,0.75)]" />
      <DialogPrimitive.Popup className={cn(contentVariants({ size }), className)} {...props}>
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("border-line flex items-start gap-3 border-b px-6 py-5", className)}>
      {icon ? (
        <span className="bg-accent-soft text-accent rounded-card flex size-9 shrink-0 items-center justify-center [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <DialogPrimitive.Title className="text-20 text-ink font-serif font-bold">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-13 text-ink-muted">
            {description}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      <DialogPrimitive.Close
        aria-label="Close"
        className="text-ink-subtle hover:text-ink rounded-control cursor-pointer p-1"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </div>
  )
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("text-14 text-ink min-h-0 flex-1 overflow-y-auto px-6 py-5", className)} {...props} />
  )
}

/** `note` is the muted text on the left; the actions go on the right. */
export function DialogFooter({
  note,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { note?: ReactNode }) {
  return (
    <div className={cn("border-line flex items-center gap-3 border-t px-6 py-4", className)} {...props}>
      <div className="text-12 text-ink-subtle min-w-0 flex-1">{note}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
