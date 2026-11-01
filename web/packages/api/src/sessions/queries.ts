import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { NotesSessionInput } from "../campaign/types.ts"
import { putJob } from "../query/cache.ts"
import { keys } from "../query/keys.ts"
import {
  cancelRefresh,
  deleteSession,
  editSessionNotes,
  estimateInCharacter,
  fixSpellings,
  improveSession,
  markReviewed,
  mergeSessions,
  refreshSession,
  reorderUnknownSessions,
  sessionNotes,
  restoreSession,
  retranscribeSession,
  sessionQuality,
  sessionUpgrades,
  sessionRecord,
  sessions,
  undeleteSession,
  unmergeSession,
  upgradeSessions,
} from "./endpoints.ts"

/** The open campaign's saved sessions, newest first. The bridge refetches when a live session ends. */
export function useSessions() {
  return useQuery({ queryKey: keys.sessions(), queryFn: sessions })
}

export function useSessionNotes(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["notes", id ?? ""] as const,
    queryFn: () => sessionNotes(id!),
    enabled: !!id && enabled,
  })
}

/** Put the sessions with unknown dates in a new order (`mutate(idsOldestFirst)`). A refused order refetches the list. */
export function useReorderUnknownSessions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => reorderUnknownSessions(ids),
    onSuccess: (list) => {
      client.setQueryData(keys.sessions(), list)
      return client.invalidateQueries({ queryKey: keys.timeline() })
    },
    onError: () => client.invalidateQueries({ queryKey: keys.sessions() }),
  })
}

/** Change a notes session's notes, date or title; the notes are read again as a job. */
export function useEditSessionNotes(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (notes: NotesSessionInput) => editSessionNotes(id, notes),
    onSuccess: (job) => {
      putJob(client, job)
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.sessions() }),
        client.invalidateQueries({ queryKey: ["notes", id] }),
        client.invalidateQueries({ queryKey: keys.timeline() }),
      ])
    },
  })
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

/** Undo the last merge into a session. */
export function useUnmergeSession() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unmergeSession(id),
    onSuccess: (_r, id) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.sessions() }),
        client.invalidateQueries({ queryKey: keys.record(id) }),
      ]),
  })
}

/** Delete saved sessions (to the server's trash), one request each. */
export function useDeleteSessions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await deleteSession(id)
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.sessions() }),
  })
}

/** Bring deleted sessions back. */
export function useUndeleteSessions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await undeleteSession(id)
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.sessions() }),
  })
}

/** Mark one saved session reviewed (`mutate(true)`) or not (`mutate(false)`). */
export function useMarkReviewed(id: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (reviewed: boolean) => markReviewed(id, reviewed),
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

/** Run every processing step that can run on one saved session. */
export const useRefreshSession = () => useSessionJob(refreshSession)

/** Stop a running refresh before its next step. */
export function useCancelRefresh() {
  return useMutation({ mutationFn: (jobId: string) => cancelRefresh(jobId) })
}

/** Sessions an older Troubadour processed. Under the sessions key, so whatever refreshes the list refreshes this. */
export function useUpgrades() {
  return useQuery({ queryKey: [...keys.sessions(), "upgrades"], queryFn: sessionUpgrades })
}

/** Queue the stale steps of every out-of-date session; the jobs arrive in the campaign's job list. */
export function useUpgradeSessions() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: upgradeSessions,
    onSuccess: (jobs) => jobs.forEach((job) => putJob(client, job)),
  })
}
