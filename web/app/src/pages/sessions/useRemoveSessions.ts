import { useDeleteSessions, useUndeleteSessions } from "@troubadour/api/sessions"
import { notify } from "@troubadour/ui/toast"

/** Delete saved sessions (they go to the server's trash), then offer one Undo for all of them. */
export function useRemoveSessions() {
  const remove = useDeleteSessions()
  const restore = useUndeleteSessions()
  return async (ids: string[]) => {
    await remove.mutateAsync(ids)
    notify(ids.length === 1 ? "Session deleted" : `${ids.length} sessions deleted`, {
      undo: () => restore.mutate(ids, { onError: (e) => notify(e.message, { tone: "danger" }) }),
      duration: 8000,
    })
  }
}
