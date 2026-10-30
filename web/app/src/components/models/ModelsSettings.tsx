import { useEffect, useState } from "react"
import { AudioLines, Loader2, Lock, Users } from "lucide-react"
import {
  useLlmModels,
  useLocalServers,
  useModelSettings,
  useSaveModelSettings,
  useScanLocalModels,
  type LlmModel,
  type LlmProviderId,
  type ModelSettings as ModelSettingsData,
} from "@troubadour/api/llm"
import { Badge } from "@troubadour/ui/badge"
import { Button } from "@troubadour/ui/button"
import { Field } from "@troubadour/ui/field"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Spinner } from "@troubadour/ui/spinner"
import { HostedProvider } from "./HostedProvider.tsx"
import { LOCAL_PRICE_NOTE, providerSubtitle, withExtra, type LocalServerInfo } from "./helpers.ts"
import { LocalServer } from "./LocalServer.tsx"
import { ModelPicker } from "./ModelPicker.tsx"
import { ProviderCard } from "./ProviderCard.tsx"
import { ServerPick } from "./ServerPick.tsx"

const asModels = (ids: string[]): LlmModel[] => ids.map((id) => ({ id, name: id, price: null }))

/** Which Whisper this Mac uses, and where the language model runs (this Mac, or a hosted provider the user
 * signs in to or adds a key for). A section: the page that hosts it supplies the heading. */
export function ModelsSettings() {
  const settings = useModelSettings()
  const servers = useLocalServers()
  if (settings.isError)
    return (
      <p role="alert" className="text-14 text-danger">
        {settings.error.message}
      </p>
    )
  if (!settings.data) return <Spinner />
  return <Form settings={settings.data} servers={servers.data} />
}

function Form({
  settings,
  servers,
}: {
  settings: ModelSettingsData
  servers: LocalServerInfo[] | undefined
}) {
  const [whisper, setWhisper] = useState(settings.whisper)
  const [whisperImprove, setWhisperImprove] = useState(settings.whisper_improve)
  const [provider, setProvider] = useState<LlmProviderId>(settings.provider)
  const [llm, setLlm] = useState(settings.llm)
  const [memory, setMemory] = useState(settings.memory)
  const [url, setUrl] = useState(settings.llm_url)
  const [apiKey, setApiKey] = useState(settings.api_key)
  // The write-up model's own server ("" = auto: the one above) and what it offers.
  const [memoryUrl, setMemoryUrl] = useState(settings.memory_url ?? "")
  const [memoryChoices, setMemoryChoices] = useState<string[] | null>(null)
  const [installed, setInstalled] = useState(settings.installed)
  const [hosted, setHosted] = useState(settings.hosted)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [scan, setScan] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null })
  const scanModels = useScanLocalModels()
  const save = useSaveModelSettings()

  const providers = settings.providers
  const chosen = provider === "local" ? null : (providers.find((p) => p.id === provider) ?? null)
  const hostedId = chosen?.id
  const connected = !!chosen?.connected
  const list = useLlmModels(hostedId, connected)

  // ChatGPT has no default: start from the first model the account offers.
  const firstModel = list.data?.models[0]?.id
  useEffect(() => {
    if (!hostedId || !firstModel) return
    setHosted((h) => {
      const pair = h[hostedId]
      if (pair.llm && pair.memory) return h
      return { ...h, [hostedId]: { llm: pair.llm || firstModel, memory: pair.memory || firstModel } }
    })
  }, [hostedId, firstModel])

  async function scanMemory(address: string, key = apiKey) {
    setMemoryChoices(null)
    try {
      setMemoryChoices((await scanModels.mutateAsync({ llm_url: address, api_key: key.trim() })).installed)
    } catch {
      setMemoryChoices([])
    }
  }
  useEffect(() => {
    if (settings.memory_url) void scanMemory(settings.memory_url, settings.api_key)
    // Once, for the server saved with the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask the server in the address box what it offers now: after loading or downloading a model there.
  async function rescan(address: string) {
    setScan({ busy: true, note: null })
    try {
      const r = await scanModels.mutateAsync({ llm_url: address.trim(), api_key: apiKey.trim() })
      setInstalled(r.installed)
      setScan({ busy: false, note: r.error ?? `Found ${r.found} ${r.found === 1 ? "model" : "models"}.` })
    } catch (e) {
      setScan({ busy: false, note: (e as Error).message })
    }
  }

  const pair = chosen ? hosted[chosen.id] : { llm, memory }
  const setPair = (role: "llm" | "memory", value: string) => {
    setSaved(false)
    if (!chosen) return role === "llm" ? setLlm(value) : setMemory(value)
    setHosted((h) => ({ ...h, [chosen.id]: { ...h[chosen.id], [role]: value } }))
  }
  const choices = chosen ? (list.data?.models ?? []) : asModels(installed)
  const memoryModels = !chosen && memoryUrl && memoryChoices ? asModels(memoryChoices) : choices
  const priceNote = chosen ? list.data?.price_note : LOCAL_PRICE_NOTE
  const listError = chosen?.connected
    ? (list.data?.error ?? (list.isError ? list.error.message : null))
    : null
  const ready = !!pair.llm.trim() && !!pair.memory.trim() && (!chosen || connected)

  async function onSave() {
    setError(null)
    try {
      await save.mutateAsync({
        whisper,
        whisper_improve: whisperImprove,
        provider,
        ...(chosen
          ? { hosted: { [chosen.id]: { llm: pair.llm.trim(), memory: pair.memory.trim() } } }
          : {
              llm: llm.trim(),
              memory: memory.trim(),
              llm_url: url.trim(),
              memory_url: memoryUrl,
              api_key: apiKey.trim(),
            }),
      })
      setSaved(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const whisperOptions = withExtra(settings.whisper_options, whisper, whisperImprove)

  return (
    <div className="flex flex-col gap-4 text-14">
      <p className="text-13 text-ink-subtle">
        Saved on this Mac. A new choice is used the next time Troubadour transcribes or asks.
      </p>

      <FixedRow icon={<AudioLines className="size-[18px]" />} title="Speech to text">
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Live transcription">
            <NativeSelect
              value={whisper}
              onChange={(e) => {
                setWhisper(e.target.value)
                setSaved(false)
              }}
            >
              {whisperOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Improve transcript">
            <NativeSelect
              value={whisperImprove}
              onChange={(e) => {
                setWhisperImprove(e.target.value)
                setSaved(false)
              }}
            >
              {whisperOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      </FixedRow>

      <FixedRow icon={<Users className="size-[18px]" />} title="Who's speaking">
        {/* One voice model for now; shown so every model Troubadour runs is in one place. */}
        <div className="mt-3">
          <Field label="Speaker matching">
            <NativeSelect value={settings.speaker} onChange={() => {}}>
              <option value={settings.speaker}>{settings.speaker_label}</option>
            </NativeSelect>
          </Field>
        </div>
      </FixedRow>

      <div className="mt-1 flex flex-col gap-2.5">
        <div className="flex items-baseline">
          <span className="font-bold">Notes, write-ups and answers</span>
          <span className="ml-auto text-12 text-ink-subtle">Needs a language model</span>
        </div>
        <div role="radiogroup" aria-label="Language model provider" className="flex flex-col gap-2.5">
          <ProviderCard
            title="LM Studio on this Mac"
            subtitle={`${settings.llm} · ${settings.llm_url}`}
            state={settings.provider === "local" ? { text: "Connected", connected: true } : null}
            selected={provider === "local"}
            onSelect={() => setProvider("local")}
          >
            <LocalServer
              url={url}
              onUrl={(v) => {
                setUrl(v)
                setSaved(false)
              }}
              apiKey={apiKey}
              onApiKey={setApiKey}
              servers={servers}
              scan={scan}
              onRescan={(a) => void rescan(a)}
            />
          </ProviderCard>
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              title={p.label}
              subtitle={providerSubtitle(p)}
              state={
                p.connected
                  ? { text: "Connected", connected: true }
                  : { text: p.sign_in ? "Sign in" : "Add key", connected: false }
              }
              selected={provider === p.id}
              onSelect={() => setProvider(p.id)}
            >
              <HostedProvider provider={p} onError={setError} />
            </ProviderCard>
          ))}
        </div>

        <ModelPicker
          label="Live spelling"
          value={pair.llm}
          models={choices}
          onChange={(v) => setPair("llm", v)}
        />
        <ModelPicker
          label="Questions, write-ups, and facts"
          value={pair.memory}
          models={memoryModels}
          onChange={(v) => setPair("memory", v)}
        />
        {!chosen && (
          <div className="flex flex-col gap-1">
            <span className="text-12 text-ink-subtle">Its server</span>
            <ServerPick
              label="Server for questions, write-ups, and facts"
              servers={servers}
              value={memoryUrl}
              auto="Auto (the model server above)"
              onPick={(address) => {
                setSaved(false)
                setMemoryUrl(address)
                if (address) void scanMemory(address)
                else setMemoryChoices(null)
              }}
            />
          </div>
        )}
        {priceNote && <p className="text-12 text-ink-subtle">{priceNote}</p>}
        {chosen ? (
          <p className="text-12 text-ink-subtle">
            {listError ? `${listError} ` : ""}
            Transcripts and notes go to {chosen.label} for spelling cleanup, write-ups, note import and
            questions. Whisper and voices stay on this Mac.
          </p>
        ) : (
          <p className="text-12 text-ink-subtle">
            A port means this Mac. A host and port reaches another machine; leave the key empty for LM Studio.
            The model list is what that server offers, plus any model you have chosen here before.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-14 text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!ready || save.isPending} onClick={() => void onSave()}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
        {saved && <span className="text-12 text-success">Saved</span>}
      </div>
    </div>
  )
}

function FixedRow({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        <div className="flex size-9 items-center justify-center rounded-card bg-elevated">{icon}</div>
        <div className="font-semibold">{title}</div>
        <Badge tone="success" className="ml-auto">
          <Lock className="size-[11px]" /> Local only
        </Badge>
      </div>
      {children}
    </div>
  )
}
