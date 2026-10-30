import { req, segment } from "../http/index.ts"
import type { LlmModel, LlmProvider, ModelSettings } from "./types.ts"

export const modelSettings = () => req<ModelSettings>("GET", "/api/settings/models")

/** Only the fields sent change; `hosted` sets one provider's pair without touching the others. */
export const saveModelSettings = (
  body: Partial<
    Pick<
      ModelSettings,
      "whisper" | "whisper_improve" | "llm" | "memory" | "llm_url" | "memory_url" | "api_key" | "provider"
    >
  > & { hosted?: Partial<ModelSettings["hosted"]> },
) => req<ModelSettings>("PUT", "/api/settings/models", body)

/** The usual local model server ports on this Mac, and which of them answer. */
export const localServers = () =>
  req<{ port: number; name: string; url: string; running: boolean; models: number }[]>(
    "GET",
    "/api/llm/local/servers",
  )

/** What a local model server offers now (the typed address, saved or not), plus models chosen before. */
export const scanLocalModels = (llm_url: string, api_key: string) =>
  req<{ installed: string[]; found: number; error: string | null }>("POST", "/api/llm/local/models", {
    llm_url,
    api_key,
  })

/** What a hosted provider offers the signed-in account; `error` says why the list is empty, and
 * `price_note` stands in when the provider's list has no prices. */
export const llmModels = (provider: LlmProvider["id"]) =>
  req<{ models: LlmModel[]; error: string | null; price_note: string | null }>(
    "GET",
    `/api/llm/models?provider=${segment(provider)}`,
  )

/** Start a browser sign-in (ChatGPT, OpenRouter). `fresh`: ChatGPT with another account. */
export const llmConnect = (provider: LlmProvider["id"], fresh = false) =>
  req<{ authorize_url: string }>("POST", `/api/llm/${provider}/connect`, { fresh })

export const llmKey = (provider: LlmProvider["id"], key: string) =>
  req<LlmProvider[]>("PUT", `/api/llm/${provider}/key`, { key })

/** `revoked`: false when ChatGPT couldn't confirm the sign-out (it can be disconnected in ChatGPT's settings). */
export const llmDisconnect = (provider: LlmProvider["id"]) =>
  req<{ providers: LlmProvider[]; revoked: boolean }>("POST", `/api/llm/${provider}/disconnect`)
