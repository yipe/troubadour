import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { putLlmState, type LlmProvider, type ModelSettings } from "@troubadour/api/llm"
import { mockFetch } from "@troubadour/api/testing"
import { renderWithProviders } from "../../test/render.tsx"
import { ModelsSettings } from "./ModelsSettings.tsx"

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
    memory_url: "",
    has_api_key: false,
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

async function openSection() {
  const view = renderWithProviders(<ModelsSettings />)
  await screen.findByLabelText("Live spelling")
  await act(async () => {})
  return view
}

const PROVIDER_NAMES = { openai: /ChatGPT plan/, anthropic: /Anthropic API/, openrouter: /OpenRouter/ }
function chooseProvider(id: keyof typeof PROVIDER_NAMES) {
  fireEvent.click(screen.getByRole("radio", { name: PROVIDER_NAMES[id] }))
}

function pick(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function model(id: string) {
  return { id, name: id, price: null }
}

afterEach(() => vi.restoreAllMocks())

describe("Models settings", () => {
  it("keeps this computer's server settings when the model runs locally", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
    })
    await openSection()
    pick("Questions, write-ups, and facts", "gemma")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes()[0]?.body).toEqual({
      whisper: "turbo",
      whisper_improve: "large",
      provider: "local",
      llm: "gemma",
      memory: "gemma",
      llm_url: "http://127.0.0.1:1235/v1",
      memory_url: "",
      api_key: "",
    })
  })

  it("shows Key saved instead of the key, and saves a replacement only when one is typed", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings({ has_api_key: true })
    })
    await openSection()
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument()
    expect(screen.getByText("Key saved")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes()[0]?.body).toMatchObject({ api_key: "" }) // "" keeps the saved key
    fireEvent.click(screen.getByRole("button", { name: "Replace" }))
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: " new-key " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes()[1]?.body).toMatchObject({ api_key: "new-key" })
  })

  it("rescans the typed server for the models it offers now", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
      if (call.url === "/api/llm/local/models")
        return { installed: ["qwen3.8-27b", "gemma", "qwen"], found: 1, error: null }
    })
    await openSection()
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

  it("offers the usual local servers, and picking one rescans it", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
      if (call.url === "/api/llm/local/servers")
        return [
          { port: 1234, name: "LM Studio", url: "http://127.0.0.1:1234/v1", running: false, models: 0 },
          { port: 8000, name: "MTPLX / vLLM", url: "http://127.0.0.1:8000/v1", running: true, models: 1 },
        ]
      if (call.url === "/api/llm/local/models") return { installed: ["mtplx-qwen"], found: 1, error: null }
    })
    await openSection()
    fireEvent.click(screen.getByRole("button", { name: "Common servers" }))
    await act(async () => {})
    const list = screen.getByRole("list", { name: "Common servers" })
    const rows = within(list).getAllByRole("button") as [HTMLElement, HTMLElement]
    expect(rows.map((r) => r.textContent)).toEqual(["–LM Studio · 1234", "1MTPLX / vLLM · 8000"]) // count first
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, null]) // 1235 is in use: not listed
    expect(within(rows[0]).getByTitle("not running")).toHaveClass("bg-elevated")
    expect(within(rows[1]).getByTitle("1 model")).toHaveClass("bg-accent-strong")
    fireEvent.click(rows[1])
    await act(async () => {})
    fireEvent.click(screen.getByRole("button", { name: "Common servers" }))
    await act(async () => {})
    expect(screen.getByRole("button", { name: /MTPLX/ })).toHaveAttribute("aria-current", "true") // now the one in use
    await act(async () => {})
    const box = screen.getByLabelText("Model server")
    expect(box).toHaveValue("MTPLX / vLLM · 8000") // a known server reads by name
    fireEvent.focus(box)
    expect(box).toHaveValue("http://127.0.0.1:8000/v1") // editing shows the address
    expect(writes()).toEqual([
      {
        method: "POST",
        url: "/api/llm/local/models",
        body: { llm_url: "http://127.0.0.1:8000/v1", api_key: "" },
      },
    ])
  })

  it("can put the write-up model on another server, Auto by default", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models" && call.method === "GET") return settings()
      if (call.url === "/api/llm/local/servers")
        return [
          { port: 8000, name: "MTPLX / vLLM", url: "http://127.0.0.1:8000/v1", running: true, models: 1 },
        ]
      if (call.url === "/api/llm/local/models") return { installed: ["mtplx-qwen"], found: 1, error: null }
      if (call.url === "/api/settings/models") return settings()
    })
    await openSection()
    const server = screen.getByRole("button", { name: "Server for questions, write-ups, and facts" })
    expect(server).toHaveTextContent("Auto (the model server above)")
    fireEvent.click(server)
    await act(async () => {})
    fireEvent.click(screen.getByRole("button", { name: /MTPLX \/ vLLM/ }))
    await act(async () => {})
    pick("Questions, write-ups, and facts", "mtplx-qwen") // its list is that server's models
    expect(screen.getByLabelText("Live spelling")).toHaveValue("gemma")
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await act(async () => {})
    expect(writes().at(-1)?.body).toMatchObject({
      llm: "gemma",
      memory: "mtplx-qwen",
      llm_url: "http://127.0.0.1:1235/v1",
      memory_url: "http://127.0.0.1:8000/v1",
    })
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
    await openSection()
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
    await openSection()
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
    const { client } = await openSection()
    chooseProvider("openai")
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
    act(() => putLlmState(client, { provider: "local", providers: [signedIn] }))
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
    await openSection()
    chooseProvider("anthropic")
    expect(screen.getByText(/doesn't let other apps use Claude subscriptions/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Anthropic API key"), { target: { value: "sk-ant-1234" } })
    fireEvent.click(screen.getByRole("button", { name: "Add key" }))
    await act(async () => {})
    expect(writes()).toEqual([{ method: "PUT", url: "/api/llm/anthropic/key", body: { key: "sk-ant-1234" } }])
    expect(await screen.findByText(/Connected · key …1234/)).toBeInTheDocument()
    expect(await screen.findByText("Anthropic's model list has no prices")).toBeInTheDocument()
    expect(screen.getByLabelText("Live spelling")).toHaveValue("claude-haiku-5-5")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
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
    await openSection()
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
    await openSection()
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    await act(async () => {})
    expect(await screen.findByText(/didn't confirm the sign-out/)).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Continue with ChatGPT" })).toBeInTheDocument()
  })

  it("choosing a hosted provider that isn't signed in shows Sign in and doesn't save the choice", async () => {
    const { writes } = mockFetch((call) => {
      if (call.url === "/api/settings/models") return settings()
    })
    await openSection()
    expect(screen.getByRole("radio", { name: /ChatGPT plan/ })).toHaveTextContent("Sign in")
    expect(screen.getByRole("radio", { name: /Anthropic API/ })).toHaveTextContent("Add key")
    chooseProvider("openai")
    expect(screen.getByRole("radio", { name: /ChatGPT plan/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(writes()).toEqual([])
  })
})
