import { ChevronDown, Download } from "lucide-react"
import { transcriptUrl } from "@troubadour/api/session"
import { sessionAudioUrl, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"

export type ExportMenuProps = {
  session: SavedSession
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Plain links with `download`: the browser saves the file, nothing runs in the page. */
export function ExportMenu({ session, open, onOpenChange }: ExportMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button size="lg" variant="ghost">
            <Download className="size-3.5" />
            Export
            <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent>
        <DropdownMenuItem render={<a href={transcriptUrl("md", session.id)} download />}>
          Markdown
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={transcriptUrl("json", session.id)} download />}>
          JSON
        </DropdownMenuItem>
        {session.audio && (
          <DropdownMenuItem render={<a href={sessionAudioUrl(session.id)} download />}>
            Audio (.wav)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
