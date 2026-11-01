import { Clock, Loader2 } from "lucide-react"
import { Badge } from "@troubadour/ui/badge"
import type { NotesStatus } from "./notesStatus.ts"

/** "Notes" once read; while it waits or is read, which of those it is. */
export function NotesStatusBadge({ status, className }: { status: NotesStatus; className?: string }) {
  switch (status.state) {
    case "queued":
      return (
        <Badge tone="info" {...(className ? { className } : {})}>
          <Clock className="size-3" /> Queued
        </Badge>
      )
    case "reading":
      return (
        <Badge tone="accent" {...(className ? { className } : {})}>
          <Loader2 className="size-3 animate-spin" /> Reading notes
        </Badge>
      )
    case "unread":
      return (
        <Badge tone="warning" {...(className ? { className } : {})}>
          Not read
        </Badge>
      )
    case "read":
      return <Badge {...(className ? { className } : {})}>Notes</Badge>
  }
}
