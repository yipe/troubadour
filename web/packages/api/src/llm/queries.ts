import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import {
  llmConnect,
  llmDisconnect,
  llmKey,
  llmModels,
  localServers,
  modelSettings,
  saveModelSettings,
  scanLocalModels,
} from "./endpoints.ts"
import type { LlmProvider, LlmProviderId, ModelSettings } from "./types.ts"

/** The picked provider and the hosted ones, as `llm.updated` sends them. */
export interface LlmState {
  provider: LlmProviderId
  providers: LlmProvider[]
}

/** Both caches that hold the provider list: this one and the full model settings. */
export function putLlmState(client: QueryClient, state: LlmState) {
  client.setQueryData<LlmState>(keys.llm(), state)
  client.setQueryData<ModelSettings>(keys.models(), (m) => m && { ...m, ...state })
}

/** Hosted providers and whether this computer is signed in to each; `llm.updated` keeps it current. */
export function useLlm() {
  return useQuery({
    queryKey: keys.llm(),
    queryFn: async (): Promise<LlmState> => {
      const { provider, providers } = await modelSettings()
      return { provider, providers }
    },
  })
}

export function useModelSettings() {
  return useQuery({ queryKey: keys.models(), queryFn: modelSettings })
}

/** What a hosted provider offers the signed-in account. */
export function useLlmModels(provider: LlmProvider["id"] | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.llmModels(provider ?? ""),
    queryFn: () => llmModels(provider!),
    enabled: enabled && !!provider,
  })
}

/** Local model servers on this computer and which answer. */
export function useLocalServers(enabled = true) {
  return useQuery({ queryKey: keys.localServers(), queryFn: localServers, enabled, staleTime: 0 })
}

export function useScanLocalModels() {
  return useMutation({
    mutationFn: (v: { llm_url: string; api_key: string }) => scanLocalModels(v.llm_url, v.api_key),
  })
}

export function useSaveModelSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof saveModelSettings>[0]) => saveModelSettings(body),
    onSuccess: (settings) => {
      client.setQueryData(keys.models(), settings)
      client.setQueryData<LlmState>(keys.llm(), {
        provider: settings.provider,
        providers: settings.providers,
      })
    },
  })
}

/** Start a browser sign-in; the page opens `authorize_url`. Completion arrives as `llm.updated`. */
export function useLlmConnect() {
  return useMutation({
    mutationFn: (v: { provider: LlmProvider["id"]; fresh?: boolean }) => llmConnect(v.provider, v.fresh),
  })
}

function useProvidersWrite<TVars, TRes>(
  call: (vars: TVars) => Promise<TRes>,
  providersOf: (res: TRes) => LlmProvider[],
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: (res) => {
      const providers = providersOf(res)
      client.setQueryData<LlmState>(keys.llm(), (s) => s && { ...s, providers })
      client.setQueryData<ModelSettings>(keys.models(), (m) => m && { ...m, providers })
      return client.invalidateQueries({ queryKey: ["llmModels"] })
    },
  })
}

export const useLlmKey = () =>
  useProvidersWrite(
    (v: { provider: LlmProvider["id"]; key: string }) => llmKey(v.provider, v.key),
    (p) => p,
  )

/** Resolves to `revoked`: false when ChatGPT couldn't confirm the sign-out. */
export const useLlmDisconnect = () =>
  useProvidersWrite(
    (provider: LlmProvider["id"]) => llmDisconnect(provider),
    (r) => r.providers,
  )
