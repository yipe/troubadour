import type { LlmModel, LlmProvider } from "@troubadour/api/llm"

export type LocalServerInfo = { port: number; name: string; url: string; running: boolean; models: number }

export const LOCAL_LABEL = "This Mac (LM Studio or another server)"
export const LOCAL_PRICE_NOTE = "Runs on this Mac: no per-token cost."

/** The known options, plus any chosen id the list no longer offers, so a saved choice still shows. */
export function withExtra(known: { id: string; label: string }[], ...extra: string[]) {
  const seen = new Set(known.map((o) => o.id))
  const out = [...known]
  for (const id of extra) {
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push({ id, label: id })
    }
  }
  return out
}

export function modelLabel(m: LlmModel): string {
  const name = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id
  return m.price ? `${name} · ${m.price}` : name
}

export function providerBlurb(p: LlmProvider): string {
  switch (p.id) {
    case "openai":
      return "Uses your ChatGPT Go, Plus or Pro plan instead of an API key. You can limit Troubadour's share in ChatGPT's usage settings."
    case "openrouter":
      return "Signing in creates a key on your OpenRouter account; requests use your OpenRouter credits."
    case "anthropic":
      return "Anthropic doesn't let other apps use Claude subscriptions, so this bills your Anthropic API account."
    case "deepseek":
      return "Bills your DeepSeek API account."
  }
}

export function providerSubtitle(p: LlmProvider): string {
  if (p.connected && p.account) return p.account
  switch (p.id) {
    case "openai":
      return "Use your Go, Plus or Pro subscription"
    case "openrouter":
      return "Pick any hosted model"
    default:
      return "Paste an API key"
  }
}
