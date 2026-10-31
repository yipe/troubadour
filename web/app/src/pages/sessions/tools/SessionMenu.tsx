import { useState } from "react"
import { useNavigate } from "react-router"
import { Ellipsis, GitMerge, NotebookPen, Trash2, Wand2 } from "lucide-react"
import type { SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { paths } from "../../../paths.ts"
import { useRemoveSessions } from "../useRemoveSessions.ts"

export type SessionMenuProps = {
  session: SavedSession
  onMerge: () => void
  onImprove: () => void
  /** Run the write-up again (it replaces the session's page); only offered once there is a page to replace. */
  onWriteUp?: () => void
}

/** The detail header's "…": improve the transcript, write it up again, merge with another session, or delete this one. */
export function SessionMenu({ session, onMerge, onImprove, onWriteUp }: SessionMenuProps) {
  const [deleting, setDeleting] = useState(false)
  const remove = useRemoveSessions()
  const navigate = useNavigate()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="lg" variant="ghost" aria-label="More for this session">
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent>
          <DropdownMenuItem icon={<Wand2 />} onClick={onImprove}>
            Improve transcript…
          </DropdownMenuItem>
          {onWriteUp ? (
            <DropdownMenuItem icon={<NotebookPen />} onClick={onWriteUp}>
              Write up again
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem icon={<GitMerge />} onClick={onMerge}>
            Merge with…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Trash2 />} danger onClick={() => setDeleting(true)}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this session?"
        body="Moves the recording and transcript to the trash. The write-up note in your vault stays."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          await remove([session.id])
          void navigate(paths.sessions())
        }}
      />
    </>
  )
}
