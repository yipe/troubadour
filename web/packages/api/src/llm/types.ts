import type { Schemas } from "../generated/index.ts"

/** Where the language model runs: this computer's server (`llm_url`, LM Studio by default) or a hosted provider. */
export type LlmProviderId = "local" | "openai" | "openrouter" | "anthropic" | "deepseek"

/** A hosted provider and whether this computer is signed in to it. Never carries a key or token.
 * `sign_in`: a browser sign-in (ChatGPT, OpenRouter); the others take a pasted key. `account` is a ChatGPT
 * email or "key …abcd"; `known_account` the ChatGPT account last signed in, even after signing out. */
export type LlmProvider = Schemas["LlmProviderOut"]

/** Which models this computer uses. `installed` is what the local server is offering right now. `llm` and
 * `memory` are the local models; `hosted` holds each hosted provider's own pair. `memory_url` is the
 * write-up model's server ("" = auto, llm_url's). The API key is never sent to the page: `has_api_key`. */
export type ModelSettings = Schemas["ModelSettings"]

/** One model a provider offers. `price` only where the provider's model list has one (OpenRouter). */
export interface LlmModel {
  id: string
  name: string
  price: string | null /* e.g. "$3.00 in · $15.00 out per 1M tokens", or "free" */
}
