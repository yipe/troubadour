import { useState } from "react"
import { useNavigate } from "react-router"
import { Ellipsis, GitMerge, Trash2 } from "lucide-react"
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
}

/** The detail header's "…": merge with another session, or delete this one (to the trash, with Undo). */
export function SessionMenu({ session, onMerge }: SessionMenuProps) {
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
