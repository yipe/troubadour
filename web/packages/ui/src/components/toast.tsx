import { Toaster as Sonner, toast } from "sonner"

/** Bottom-centre, in the tooltip colours. */
export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "text-13 text-ink flex w-full items-center gap-3 rounded-control border border-popover-line bg-popover px-3.5 py-2.5 shadow-popover",
          actionButton: "text-13 text-accent cursor-pointer font-semibold hover:text-ink",
          error: "text-danger",
        },
      }}
    />
  )
}

export function notify(
  text: string,
  options: { undo?: () => void; tone?: "neutral" | "danger"; duration?: number } = {},
) {
  const { undo, tone = "neutral", duration = 4000 } = options
  const base = {
    duration,
    action: undo ? { label: "Undo", onClick: undo } : undefined,
  }
  return tone === "danger" ? toast.error(text, base) : toast(text, base)
}
