import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { putJob } from "../query/cache.ts"
import { keys } from "../query/keys.ts"
import {
  cloud,
  cloudAccount,
  cloudBackup,
  cloudConnect,
  cloudDisconnect,
  cloudOptions,
  cloudRestore,
  cloudVaults,
} from "./endpoints.ts"
import type { CloudStatus } from "./types.ts"

/** Backup status for the open campaign; `cloud.updated` events replace it. */
export function useCloud() {
  return useQuery({ queryKey: keys.cloud(), queryFn: cloud })
}

/** Who is signed in. Quiet: with no account the header just shows initials, so no retry. */
export function useCloudAccount() {
  return useQuery({ queryKey: keys.cloudAccount(), queryFn: cloudAccount, retry: false })
}

/** Campaigns in Troubadour Cloud to restore from; only fetched when `enabled` (the restore dialog is open). */
export function useCloudVaults(enabled = true) {
  return useQuery({ queryKey: keys.cloudVaults(), queryFn: cloudVaults, enabled, staleTime: 0 })
}

/**
 * Open the sign-in tab during the click: after an await browsers block pop-ups. It loses its opener
 * so the sign-in page can't reach back into this tab. Pass the result to `useCloudConnect().mutate`.
 */
export function openSignInTab(): Window | null {
  const tab = window.open("about:blank", "_blank")
  if (tab) tab.opener = null
  return tab
}

/** Starts the browser sign-in; the service then calls back and the server sends `cloud.updated`. */
export function useCloudConnect() {
  return useMutation({
    mutationFn: async (tab: Window | null) => {
      try {
        const { authorize_url } = await cloudConnect()
        if (tab) tab.location.href = authorize_url
        else window.location.href = authorize_url
      } catch (e) {
        tab?.close()
        throw e
      }
    },
  })
}

function useCloudStatusWrite<TVars>(call: (vars: TVars) => Promise<CloudStatus>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: (status) => {
      client.setQueryData(keys.cloud(), status)
      return client.invalidateQueries({ queryKey: keys.cloudAccount() })
    },
  })
}

export const useCloudDisconnect = () => useCloudStatusWrite<void>(() => cloudDisconnect())
export const useCloudOptions = () =>
  useCloudStatusWrite<{ include_transcripts?: boolean; auto_backup?: boolean }>(cloudOptions)

export function useCloudBackup() {
  const client = useQueryClient()
  return useMutation({ mutationFn: () => cloudBackup(), onSuccess: (job) => putJob(client, job) })
}

export function useCloudRestore() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vaultId: string) => cloudRestore(vaultId),
    onSuccess: (job) => putJob(client, job),
  })
}
