import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { putJob } from "../query/cache.ts"
import { keys } from "../query/keys.ts"
import {
  estimateInCharacter,
  fixSpellings,
  improveSession,
  mergeSessions,
  restoreSession,
  retranscribeSession,
  sessionQuality,
  sessionRecord,
  sessions,
} from "./endpoints.ts"

/** The open campaign's saved sessions, newest first. The bridge refetches when a live session ends. */
export function useSessions() {
  return useQuery({ queryKey: keys.sessions(), queryFn: sessions })
}

export function useSessionRecord(id: string | undefined) {
  return useQuery({
    queryKey: keys.record(id ?? ""),
    queryFn: () => sessionRecord(id!),
    enabled: !!id,
  })
}

/** Measured on first request (a few seconds), then cached by the server. */
export function useSessionQuality(id: string | undefined) {
  return useQuery({
    queryKey: keys.quality(id ?? ""),
    queryFn: () => sessionQuality(id!),
    enabled: !!id,
  })
}

export function useMergeSessions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: [string, string]) => mergeSessions(ids),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.sessions() }),
  })
}

/** Start a background job on a saved session; the job arrives in the campaign's job list. */
function useSessionJob(call: (id: string) => ReturnType<typeof improveSession>) {
  const client = useQueryClient()
  return useMutation({ mutationFn: call, onSuccess: (job) => putJob(client, job) })
}

export const useImproveSession = () => useSessionJob(improveSession)
export const useRetranscribeSession = () => useSessionJob(retranscribeSession)
export const useFixSpellings = () => useSessionJob(fixSpellings)
export const useEstimateInCharacter = () => useSessionJob(estimateInCharacter)

/** Put the original transcript back. */
export function useRestoreSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => restoreSession(id),
    onSuccess: (_r, id) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.record(id) }),
        client.invalidateQueries({ queryKey: keys.sessions() }),
      ]),
  })
}
