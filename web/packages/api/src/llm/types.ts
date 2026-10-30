/** Where the language model runs: this Mac's server (`llm_url`, LM Studio by default) or a hosted provider. */
export type LlmProviderId = "local" | "openai" | "openrouter" | "anthropic" | "deepseek"

/** A hosted provider and whether this Mac is signed in to it. Never carries a key or token. */
export interface LlmProvider {
  id: Exclude<LlmProviderId, "local">
  label: string
  sign_in: boolean /* a browser sign-in (ChatGPT, OpenRouter); the others take a pasted key */
  manage_url: string /* usage and keys at the provider */
  connected: boolean
  account: string | null /* a ChatGPT email, or "key …abcd" */
  known_account: string | null /* ChatGPT: the account last signed in, even after signing out */
}

/** Which models this Mac uses. `installed` is what the local server is offering right now. `llm` and
 * `memory` are the local models; `hosted` holds each hosted provider's own pair. */
export interface ModelSettings {
  whisper: string
  whisper_improve: string
  llm: string
  memory: string
  llm_url: string
  memory_url: string /* the write-up model's server; "" = auto, llm_url's */
  api_key: string
  provider: LlmProviderId
  hosted: Record<LlmProvider["id"], { llm: string; memory: string }>
  providers: LlmProvider[]
  speaker: string
  speaker_label: string /* the exact model, e.g. "WeSpeaker ResNet34 … fp32 PyTorch" */
  whisper_options: { id: string; label: string }[]
  installed: string[]
}

/** One model a provider offers. `price` only where the provider's model list has one (OpenRouter). */
export interface LlmModel {
  id: string
  name: string
  price: string | null /* e.g. "$3.00 in · $15.00 out per 1M tokens", or "free" */
}
