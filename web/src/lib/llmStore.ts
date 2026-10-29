import { create } from "zustand"
import type { LlmProvider, ServerEvent } from "./types"

/**
 * Hosted language-model providers and whether this Mac is signed in to each: loaded by the Models dialog,
 * then kept current by `llm.updated` (a sign-in that finished in another tab, or a sign-out).
 */
export const useLlmProviders = create<{ providers: LlmProvider[] | null }>(() => ({ providers: null }))

export function setLlmProviders(providers: LlmProvider[]) {
  useLlmProviders.setState({ providers })
}

export function applyLlmEvent(ev: Extract<ServerEvent, { type: "llm.updated" }>) {
  setLlmProviders(ev.data.providers)
}
