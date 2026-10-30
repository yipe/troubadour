import { useMutation } from "@tanstack/react-query"
import type { PlayerPatch } from "./types.ts"
import {
  benchPlayer,
  cancelTraining,
  createPlayer,
  deletePlayer,
  seatPlayer,
  trainPlayer,
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
