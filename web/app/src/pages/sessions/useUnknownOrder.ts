import { useMemo, useState, type DragEvent } from "react"
import { useReorderUnknownSessions, type SavedSession } from "@troubadour/api/sessions"
import { notify } from "@troubadour/ui/toast"
import { movedTo, shifted, unknownOrder } from "./unknownOrder.ts"

/**
 * Putting the sessions whose dates are unknown in order by hand: drag one onto another (it takes that
 * one's place), or shift it a place from its menu. Dated sessions are placed by their dates.
 */
export function useUnknownOrder(sessions: SavedSession[]) {
  const reorder = useReorderUnknownSessions()
  const order = useMemo(() => unknownOrder(sessions), [sessions])
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const put = (ids: string[]) => {
    if (ids.join() !== order.join())
      reorder.mutate(ids, { onError: (e) => notify(e.message, { tone: "danger" }) })
  }
  const end = () => {
    setDragging(null)
    setOver(null)
  }

  return {
    /** The session being dragged over, to show where it would land. */
    over,
    /** Can the session be moved one place earlier (-1) or later (1)? */
    canShift: (id: string, by: -1 | 1) =>
      order.includes(id) && shifted(order, id, by).join() !== order.join(),
    shift: (id: string, by: -1 | 1) => put(shifted(order, id, by)),
    /** Drag handlers for a session's row; none for one that can't be moved. */
    dragProps: (id: string) =>
      order.includes(id)
        ? {
            draggable: true,
            onDragStart: (e: DragEvent) => {
              e.dataTransfer.effectAllowed = "move"
              e.dataTransfer.setData("text/plain", id)
              setDragging(id)
            },
            onDragOver: (e: DragEvent) => {
              if (dragging === null || dragging === id) return
              e.preventDefault() // allows the drop
              setOver(id)
            },
            onDrop: (e: DragEvent) => {
              e.preventDefault()
              if (dragging !== null) put(movedTo(order, dragging, id))
              end()
            },
            onDragEnd: end,
          }
        : {},
  }
}
