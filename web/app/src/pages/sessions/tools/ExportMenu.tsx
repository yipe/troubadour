import type { SavedSession } from "@troubadour/api/sessions"
import { Download } from "lucide-react"
import { Button } from "@troubadour/ui/button"

export type ExportMenuProps = {
  session: SavedSession
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Stub: F10 replaces this body with the export menu. */
export function ExportMenu(_props: ExportMenuProps) {
  return (
    <Button size="lg">
      <Download className="size-3.5" />
      Export
    </Button>
  )
}
