import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { putJob } from "../query/cache.ts"
import { keys } from "../query/keys.ts"
import { buildClone, buildProfile, cloneRead, cloneSay, clones, deleteClip } from "./endpoints.ts"

/** Voice clones and their clips; the bridge refetches when a clone job ends. */
export function useClones() {
  return useQuery({ queryKey: keys.clones(), queryFn: clones })
}

/** Each of these starts a background job; it shows up in the campaign's job list. */
function useCloneJob<TVars>(call: (vars: TVars) => ReturnType<typeof buildClone>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: call, onSuccess: (job) => putJob(client, job) })
}

export const useBuildClone = () => useCloneJob((id: string) => buildClone(id))
export const useBuildProfile = () => useCloneJob((id: string) => buildProfile(id))
export const useCloneSay = () =>
  useCloneJob((v: { id: string; text: string; inTheirWords?: boolean; persona?: string }) =>
    cloneSay(v.id, v.text, v.inTheirWords, v.persona),
  )
export const useCloneRead = () =>
  useCloneJob((v: { id: string; session: string; inTheirWords?: boolean; persona?: string }) =>
    cloneRead(v.id, v.session, v.inTheirWords, v.persona),
  )

export function useDeleteClip() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; clip: string }) => deleteClip(v.id, v.clip),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.clones() }),
  })
}
