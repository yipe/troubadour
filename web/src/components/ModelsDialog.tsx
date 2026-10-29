import { useEffect, useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { setLlmProviders, useLlmProviders } from "@/lib/llmStore"
import type { LlmModel, LlmProvider, LlmProviderId, ModelSettings } from "@/lib/types"

type HostedId = LlmProvider["id"]
type Hosted = ModelSettings["hosted"]
type ModelList = { models: LlmModel[]; error: string | null; price_note: string | null }

const LOCAL_LABEL = "This Mac (LM Studio or another server)"
const LOCAL_PRICE_NOTE = "Runs on this Mac: no per-token cost."

/** Account-menu dialog: which Whisper this Mac uses, and where the language model runs (this Mac, or a
 * hosted provider the user signs in to or adds a key for). */
export function ModelsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [whisper, setWhisper] = useState("")
  const [whisperImprove, setWhisperImprove] = useState("")
  const [provider, setProvider] = useState<LlmProviderId>("local")
  const [llm, setLlm] = useState("")
  const [memory, setMemory] = useState("")
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [hosted, setHosted] = useState<Hosted | null>(null)
  const [lists, setLists] = useState<Partial<Record<HostedId, ModelList>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const providers = useLlmProviders((s) => s.providers)

  useEffect(() => {
    if (!open) return
    let gone = false
    setError(null)
    void api
      .modelSettings()
      .then((s) => {
        if (gone) return
        setSettings(s)
        setWhisper(s.whisper)
        setWhisperImprove(s.whisper_improve)
        setProvider(s.provider)
        setLlm(s.llm)
        setMemory(s.memory)
        setUrl(s.llm_url)
        setApiKey(s.api_key)
        setHosted(s.hosted)
        setLlmProviders(s.providers)
      })
      .catch((e: Error) => {
        if (!gone) setError(e.message)
      })
    return () => {
      gone = true
    }
  }, [open])

  const chosen = provider === "local" ? null : (providers?.find((p) => p.id === provider) ?? null)
  const hostedId = chosen?.id ?? null
  const connected = !!chosen?.connected

  // A hosted provider's models, once it's signed in (again after a sign-in in another tab).
  useEffect(() => {
    if (!open || !hostedId || !connected) return
    let gone = false
    const id = hostedId
    void api
      .llmModels(id)
      .then((list) => {
        if (gone) return
        setLists((l) => ({ ...l, [id]: list }))
        // ChatGPT has no default: start from the first model the account offers.
        setHosted((h) => {
          const first = list.models[0]?.id
          if (!h || !first) return h
          const pair = h[id]
          return { ...h, [id]: { llm: pair.llm || first, memory: pair.memory || first } }
        })
      })
      .catch((e: Error) => {
        if (!gone) setLists((l) => ({ ...l, [id]: { models: [], error: e.message } }))
      })
    return () => {
      gone = true
    }
  }, [open, hostedId, connected])

  const pair = chosen && hosted ? hosted[chosen.id] : { llm, memory }
  const setPair = (role: "llm" | "memory", value: string) => {
    if (!chosen) return role === "llm" ? setLlm(value) : setMemory(value)
    setHosted((h) => (h ? { ...h, [chosen.id]: { ...h[chosen.id], [role]: value } } : h))
  }
  const choices: LlmModel[] = chosen
    ? (lists[chosen.id]?.models ?? [])
    : (settings?.installed ?? []).map((id) => ({ id, name: id, price: null }))
  const priceNote = chosen ? lists[chosen.id]?.price_note : LOCAL_PRICE_NOTE
  const ready = !!settings && !!pair.llm.trim() && !!pair.memory.trim() && (!chosen || connected)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const s = await api.saveModelSettings({
        whisper,
        whisper_improve: whisperImprove,
        provider,
        ...(chosen && hosted
          ? { hosted: { [chosen.id]: { llm: pair.llm.trim(), memory: pair.memory.trim() } } }
          : { llm: llm.trim(), memory: memory.trim(), llm_url: url.trim(), api_key: apiKey.trim() }),
      })
      setSettings(s)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const whisperOptions = options(settings?.whisper_options ?? [], whisper, whisperImprove)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Models</DialogTitle>
          <DialogDescription>
            Saved on this Mac. A new choice is used the next time Troubadour transcribes or asks.
          </DialogDescription>
        </DialogHeader>
        {!settings && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <Field
              label="Live transcription"
              value={whisper}
              options={whisperOptions}
              onChange={setWhisper}
            />
            <Field
              label="Improve transcript"
              value={whisperImprove}
              options={whisperOptions}
              onChange={setWhisperImprove}
            />
            {/* One voice model for now; shown so every model Troubadour runs is in one place. */}
            <Field
              label="Speaker matching"
              value={settings?.speaker ?? ""}
              options={settings ? [{ id: settings.speaker, label: settings.speaker_label }] : []}
              onChange={() => {}}
            />
            <Field
              label="Language model provider"
              value={provider}
              options={[
                { id: "local", label: LOCAL_LABEL },
                ...(providers ?? []).map((p) => ({ id: p.id, label: p.label })),
              ]}
              onChange={(id) => setProvider(id as LlmProviderId)}
            />
            {chosen ? (
              <ProviderPanel provider={chosen} onError={setError} />
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Model server</span>
                  <input
                    className="h-8 w-full rounded-lg border bg-background px-2"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="1235, or 10.0.0.8:1234"
                    spellCheck={false}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">API key</span>
                  <input
                    type="password"
                    className="h-8 w-full rounded-lg border bg-background px-2"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Only for a server that asks for one"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </>
            )}
            <ModelPicker
              label="Live spelling"
              value={pair.llm}
              models={choices}
              onChange={(v) => setPair("llm", v)}
            />
            <ModelPicker
              label="Questions, write-ups, and facts"
              value={pair.memory}
              models={choices}
              onChange={(v) => setPair("memory", v)}
            />
            {priceNote && <p className="text-xs text-muted-foreground">{priceNote}</p>}
            {chosen ? (
              <p className="text-xs text-muted-foreground">
                {chosen.connected && lists[chosen.id]?.error ? `${lists[chosen.id]?.error} ` : ""}
                Transcripts and notes go to {chosen.label} for spelling cleanup, write-ups, note import and
                questions. Whisper and voices stay on this Mac.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A port means this Mac. A host and port reaches another machine; leave the key empty for LM
                Studio. The model list is what that server offers, plus any model you have chosen here before.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || saving} onClick={() => void save()}>
            {saving && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Sign in, add a key, or sign out of one hosted provider. Changes apply at once (not on Save). */
function ProviderPanel({
  provider,
  onError,
}: {
  provider: LlmProvider
  onError: (e: string | null) => void
}) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const chatgpt = provider.id === "openai"

  async function run(work: () => Promise<void>) {
    setBusy(true)
    onError(null)
    setNote(null)
    try {
      await work()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** The tab opens during the click (after an await, browsers block pop-ups) and loses its opener. */
  function signIn(fresh = false) {
    const tab = window.open("about:blank", "_blank")
    if (tab) tab.opener = null
    void run(async () => {
      try {
        const { authorize_url } = await api.llmConnect(provider.id, fresh)
        if (tab) tab.location.href = authorize_url
        else window.location.href = authorize_url
      } catch (e) {
        tab?.close()
        throw e
      }
    })
  }

  const saveKey = () =>
    run(async () => {
      setLlmProviders(await api.llmKey(provider.id, key))
      setKey("")
    })
  const signOut = () =>
    run(async () => {
      const r = await api.llmDisconnect(provider.id)
      setLlmProviders(r.providers)
      if (!r.revoked)
        setNote("ChatGPT didn't confirm the sign-out. You can disconnect Troubadour in ChatGPT's settings.")
    })

  return (
    <div className="space-y-2 rounded-lg border p-2">
      {provider.connected ? (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {chatgpt ? "Using ChatGPT plan" : "Connected"} · {provider.account}
          </span>
          <a
            href={provider.manage_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs underline"
          >
            {chatgpt ? "Manage usage" : "Keys"} <ExternalLink className="size-3" />
          </a>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void signOut()}>
            {chatgpt ? "Sign out" : "Remove"}
          </Button>
        </div>
      ) : (
        <>
          {provider.sign_in && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => signIn()}>
                {chatgpt ? "Continue with ChatGPT" : `Sign in with ${provider.label}`}
              </Button>
              {chatgpt && provider.known_account && (
                <button
                  type="button"
                  className="text-xs underline"
                  disabled={busy}
                  onClick={() => signIn(true)}
                >
                  Use another account
                </button>
              )}
            </div>
          )}
          {!chatgpt && (
            <div className="flex gap-2">
              <input
                type="password"
                aria-label={`${provider.label} key`}
                className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider.sign_in ? "Or paste a key" : "Paste your API key"}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !key.trim()}
                onClick={() => void saveKey()}
              >
                Add key
              </Button>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">{blurb(provider)}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

function blurb(p: LlmProvider): string {
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

function options(known: { id: string; label: string }[], ...extra: string[]) {
  const seen = new Set(known.map((o) => o.id))
  const out = [...known]
  for (const id of extra) {
    if (id && !seen.has(id)) out.push({ id, label: id })
  }
  return out
}

function Field({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        className="h-8 w-full rounded-lg border bg-background px-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A model from what the chosen provider offers, with its price when the provider lists one. Free text when
 * there is no list yet (signed out, server down), so a known id can still be typed. */
function ModelPicker({
  label,
  value,
  models,
  onChange,
}: {
  label: string
  value: string
  models: LlmModel[]
  onChange: (value: string) => void
}) {
  const selected = models.find((m) => m.id === value)
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {models.length === 0 ? (
          <input
            className="h-8 w-full rounded-lg border bg-background px-2"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="google/gemma-4-26b-a4b-qat"
            spellCheck={false}
          />
        ) : (
          <select
            className="h-8 w-full rounded-lg border bg-background px-2"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {!value && <option value="">Choose a model</option>}
            {value && !selected && <option value={value}>{value} (not offered now)</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {modelLabel(m)}
              </option>
            ))}
          </select>
        )}
      </label>
      {selected?.price && <p className="text-xs text-muted-foreground">{selected.price}</p>}
    </div>
  )
}

function modelLabel(m: LlmModel): string {
  const name = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id
  return m.price ? `${name} · ${m.price}` : name
}
