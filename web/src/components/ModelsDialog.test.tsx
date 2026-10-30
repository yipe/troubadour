import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLlmProviders } from "@/lib/llmStore"
import { applyEvent } from "@/lib/store"
import type { LlmProvider, ModelSettings } from "@/lib/types"
import { mockFetch } from "@/test/mockFetch"
import { ModelsDialog } from "./ModelsDialog"

function provider(id: LlmProvider["id"], over: Partial<LlmProvider> = {}): LlmProvider {
  const labels = {
    openai: "ChatGPT plan",
    openrouter: "OpenRouter",
    anthropic: "Anthropic API",
    deepseek: "DeepSeek API",
  }
  return {
    id,
    label: labels[id],
    sign_in: id === "openai" || id === "openrouter",
    manage_url: `https://${id}.test/manage`,
    connected: false,
    account: null,
    known_account: null,
    ...over,
  }
}

function settings(over: Partial<ModelSettings> = {}): ModelSettings {
  return {
    whisper: "turbo",
    whisper_improve: "large",
    llm: "gemma",
    memory: "qwen",
    llm_url: "http://127.0.0.1:1235/v1",
    api_key: "",
    provider: "local",
    hosted: {
      openai: { llm: "", memory: "" },
      openrouter: { llm: "anthropic/claude-sonnet-5.5", memory: "anthropic/claude-sonnet-5.5" },
      anthropic: { llm: "claude-haiku-5-5", memory: "claude-sonnet-5-5" },
      deepseek: { llm: "deepseek-flash", memory: "deepseek-v4-pro" },
    },
    providers: (["openai", "openrouter", "anthropic", "deepseek"] as const).map((id) => provider(id)),
    speaker: "pyannote",
    speaker_label: "WeSpeaker ResNet34 · fp32",
    whisper_options: [
      { id: "turbo", label: "Turbo" },
      { id: "large", label: "Large" },
    ],
    installed: ["gemma", "qwen"],
    ...over,
  }
}

async function openDialog() {
  render(<ModelsDialog open onOpenChange={() => {}} />)
  await act(async () => {})
}

function pick(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function model(id: string) {
  return { id, name: id, price: null }
}

beforeEach(() => useLlmProviders.setState({ providers: null }, true))
afterEach(() => vi.restoreAllMocks())

describe("Models dialog", () => {
  it("keeps this Mac's server settings when the model runs locally", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
    })
    await openDialog()
    pick("Questions, write-ups, and facts", "gemma")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes()[0].body).toEqual({
      whisper: "turbo",
      whisper_improve: "large",
      provider: "local",
      llm: "gemma",
      memory: "gemma",
      llm_url: "http://127.0.0.1:1235/v1",
      api_key: "",
    })
  })

  it("rescans the typed server for the models it offers now", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
      if (call.url === "/api/llm/local/models")
        return { installed: ["qwen3.8-27b", "gemma", "qwen"], found: 1, error: null }
    })
    await openDialog()
    fireEvent.change(screen.getByLabelText("Model server"), { target: { value: "1234" } })
    fireEvent.click(screen.getByRole("button", { name: /Rescan/ }))
    await act(async () => {})
    expect(writes()).toEqual([
      { method: "POST", url: "/api/llm/local/models", body: { llm_url: "1234", api_key: "" } },
    ])
    expect(screen.getByRole("status")).toHaveTextContent("Found 1 model.")
    pick("Live spelling", "qwen3.8-27b")
    expect(screen.getByLabelText("Live spelling")).toHaveValue("qwen3.8-27b")
  })

  it("says why a rescan found nothing", async () => {
    mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
      if (call.url === "/api/llm/local/models")
        return {
          installed: ["gemma", "qwen"],
          found: 0,
          error: "Couldn't reach http://127.0.0.1:1235/v1 (ConnectError).",
        }
    })
    await openDialog()
    fireEvent.click(screen.getByRole("button", { name: /Rescan/ }))
    await act(async () => {})
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn't reach http://127.0.0.1:1235/v1 (ConnectError).",
    )
  })

  it("shows speaker matching with its one model, named exactly", async () => {
    mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
    })
    await openDialog()
    const select = screen.getByLabelText("Speaker matching")
    expect(select).toHaveValue("pyannote")
    const options = Array.from((select as HTMLSelectElement).options)
    expect(options.map((o) => [o.value, o.text])).toEqual([["pyannote", "WeSpeaker ResNet34 · fp32"]])
  })

  it("signs in with ChatGPT in a new tab, then uses the account's models", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window)
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models" && call.method === "GET") return settings()
      if (call.url === "/api/llm/openai/connect") return { authorize_url: "https://auth.test/authorize?x=1" }
      if (call.url === "/api/llm/models?provider=openai")
        return { models: [model("gpt-a"), model("gpt-b")], error: null, price_note: null }
      if (call.url === "/api/settings/models") return settings({ provider: "openai" })
    })
    await openDialog()
    pick("Language model provider", "openai")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }))
    await act(async () => {})
    expect(writes()).toEqual([{ method: "POST", url: "/api/llm/openai/connect", body: { fresh: false } }])
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe("https://auth.test/authorize?x=1")

    // The sign-in finishes in the other tab; the server says so over the WebSocket.
    const signedIn = provider("openai", {
      connected: true,
      account: "gm@example.com",
      known_account: "gm@example.com",
    })
    act(() => applyEvent({ type: "llm.updated", data: { provider: "local", providers: [signedIn] } }))
    await waitFor(() => expect(screen.getByLabelText("Live spelling")).toHaveValue("gpt-a"))
    expect(screen.getByText(/Using ChatGPT plan · gm@example.com/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Manage usage/ })).toHaveAttribute(
      "href",
      "https://openai.test/manage",
    )
    pick("Questions, write-ups, and facts", "gpt-b")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes().at(-1)?.body).toEqual({
      whisper: "turbo",
      whisper_improve: "large",
      provider: "openai",
      hosted: { openai: { llm: "gpt-a", memory: "gpt-b" } },
    })
  })

  it("adds an Anthropic key and says it bills the API account", async () => {
    const added = provider("anthropic", { connected: true, account: "key …1234" })
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
      if (call.url === "/api/llm/anthropic/key") return [added]
      if (call.url === "/api/llm/models?provider=anthropic")
        return {
          models: [model("claude-haiku-5-5")],
          error: null,
          price_note: "Anthropic's model list has no prices",
        }
    })
    await openDialog()
    pick("Language model provider", "anthropic")
    expect(screen.getByText(/doesn't let other apps use Claude subscriptions/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Add key" }))
    await act(async () => {})
    expect(writes()).toEqual([{ method: "PUT", url: "/api/llm/anthropic/key", body: { key: "sk-ant-1234" } }])
    expect(screen.getByText(/Connected · key …1234/)).toBeInTheDocument()
    expect(screen.getByLabelText("Live spelling")).toHaveValue("claude-haiku-5-5")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    expect(screen.getByText("Anthropic's model list has no prices")).toBeInTheDocument()
  })

  it("lists what OpenRouter offers, with prices", async () => {
    const signedIn = provider("openrouter", { connected: true, account: "key …abcd" })
    mockFetch((call) => {
      if (call.url === "/api/settings/models")
        return settings({ provider: "openrouter", providers: [signedIn] })
      if (call.url === "/api/llm/models?provider=openrouter")
        return {
          models: [
            {
              id: "anthropic/claude-sonnet-5.5",
              name: "Claude Sonnet 5.5",
              price: "$3.00 in · $15.00 out per 1M tokens",
            },
            { id: "cheap/one", name: "Cheap", price: "free" },
          ],
          error: null,
          price_note: null,
        }
    })
    await openDialog()
    const select = screen.getByLabelText("Live spelling") as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      "Claude Sonnet 5.5 (anthropic/claude-sonnet-5.5) · $3.00 in · $15.00 out per 1M tokens",
      "Cheap (cheap/one) · free",
    ])
    expect(screen.getAllByText("$3.00 in · $15.00 out per 1M tokens")).toHaveLength(2) // under each picker
    pick("Live spelling", "cheap/one")
    expect(select).toHaveValue("cheap/one")
  })

  it("tells the user when ChatGPT couldn't confirm the sign-out", async () => {
    const signedIn = provider("openai", { connected: true, account: "gm@example.com" })
    mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings({ provider: "openai", providers: [signedIn] })
      if (call.url === "/api/llm/models?provider=openai")
        return { models: [model("gpt-a")], error: null, price_note: null }
      if (call.url === "/api/llm/openai/disconnect")
        return { providers: [provider("openai")], revoked: false }
    })
    await openDialog()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    await act(async () => {})
    expect(screen.getByText(/didn't confirm the sign-out/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeInTheDocument()
  })
})
