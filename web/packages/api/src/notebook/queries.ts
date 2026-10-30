import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { addPin, liveNotebook, sessionNotebook, setNotebookStatus } from "./endpoints.ts"
import type { Notebook, NotebookItem, NotebookStatus, Pin } from "./types.ts"

/** Tonight's notebook. `notebook.updated` replaces it (query/bridge.ts); a snapshot refetches it. */
export function useNotebook() {
  return useQuery({ queryKey: keys.notebook(), queryFn: liveNotebook })
}

/** A saved session's notebook. */
export function useSessionNotebook(id: string | null | undefined) {
  return useQuery({
    queryKey: [...keys.notebook(), id] as const,
    queryFn: () => sessionNotebook(id!),
    enabled: !!id,
  })
}

/**
 * Change the cached live notebook now and undo it if the call fails. The server's own
 * `notebook.updated` event replaces the cache afterwards either way.
 */
function useOptimistic<V, R>(
  call: (v: V) => Promise<R>,
  apply: (nb: Notebook, v: V) => Notebook,
  settle?: (nb: Notebook, v: V, r: R) => Notebook,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: call,
    onMutate: async (v: V) => {
      await client.cancelQueries({ queryKey: keys.notebook(), exact: true })
      const previous = client.getQueryData<Notebook>(keys.notebook())
      if (previous) client.setQueryData(keys.notebook(), apply(previous, v))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) client.setQueryData(keys.notebook(), ctx.previous)
    },
    onSuccess: (r, v) => {
      const now = client.getQueryData<Notebook>(keys.notebook())
      if (now && settle) client.setQueryData(keys.notebook(), settle(now, v, r))
    },
  })
}

/** Keep, dismiss, or reopen an item. */
export function useSetNotebookStatus() {
  const withStatus = (nb: Notebook, id: string, status: NotebookStatus): Notebook => ({
    ...nb,
    items: nb.items.map((i: NotebookItem) => (i.id === id ? { ...i, status } : i)),
  })
  return useOptimistic(
    ({ id, status }: { id: string; status: NotebookStatus }) => setNotebookStatus(id, status),
    (nb, { id, status }) => withStatus(nb, id, status),
  )
}

/** Pin the moment `t` (session seconds). Shows at once under a temporary id. */
export function useAddPin() {
  const temp = (t: number, text: string): Pin => ({
    id: `pending-${t}-${text}`,
    t,
    text,
    created_at: Date.now() / 1000,
  })
  return useOptimistic(
    ({ t, text }: { t: number; text: string }) => addPin(t, text),
    (nb, { t, text }) => ({ ...nb, pins: [...nb.pins, temp(t, text)] }),
    // The event may already have brought the real pin; either way no temporary one stays.
    (nb, { t, text }, pin) => {
      const pins = nb.pins.filter((p) => p.id !== temp(t, text).id)
      return { ...nb, pins: pins.some((p) => p.id === pin.id) ? pins : [...pins, pin] }
    },
  )
}
