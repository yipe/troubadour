import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import type { DndClass, PlayerPatch } from "./types.ts"
import {
  addClass,
  benchPlayer,
  cancelTraining,
  classes,
  createPlayer,
  deleteClass,
  deletePlayer,
  seatPlayer,
  trainPlayer,
  updateClass,
  updatePlayer,
} from "./endpoints.ts"

// Players live in the live store (snapshot / player.upserted / player.removed events), so these
// mutations don't touch the query cache: the server's event is how the UI learns the result.

export const useCreatePlayer = () => useMutation({ mutationFn: createPlayer })

export const useUpdatePlayer = () =>
  useMutation({ mutationFn: (v: { id: string; patch: PlayerPatch }) => updatePlayer(v.id, v.patch) })

export const useDeletePlayer = () => useMutation({ mutationFn: deletePlayer })

export const useSeatPlayer = () =>
  useMutation({
    mutationFn: (v: { id: string; character?: string; is_gm?: boolean }) =>
      seatPlayer(v.id, { character: v.character, is_gm: v.is_gm }),
  })

export const useBenchPlayer = () => useMutation({ mutationFn: benchPlayer })

export const useTrainPlayer = () =>
  useMutation({ mutationFn: (v: { id: string; seconds?: number }) => trainPlayer(v.id, v.seconds) })

export const useCancelTraining = () => useMutation({ mutationFn: cancelTraining })

/** The class list: SRD built-ins first, then the user's own. Refetched after our own writes only. */
export const useClasses = () => useQuery<DndClass[]>({ queryKey: keys.classes(), queryFn: classes })

function useClassWrite<V>(fn: (v: V) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.classes() }),
  })
}

export const useAddClass = () => useClassWrite(addClass)

export const useUpdateClass = () =>
  useClassWrite((v: { id: string; label?: string; color?: string }) =>
    updateClass(v.id, { label: v.label, color: v.color }),
  )

export const useDeleteClass = () => useClassWrite(deleteClass)
