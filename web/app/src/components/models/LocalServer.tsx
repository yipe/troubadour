import { useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { useLiveStore } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { StatusDot } from "@troubadour/ui/status-dot"
import type { LocalServerInfo } from "./helpers.ts"
import { ServerPick } from "./ServerPick.tsx"

/** Whether the saved model server answers with the chosen model (the app's health check, every 30 s). */
function ServerStatus({ scanned }: { scanned: string | null }) {
  const llm = useLiveStore((s) => s.session?.llm)
  if (!llm || scanned) return null
  return (
    <p role="status" className="flex items-center gap-1.5 text-12 text-ink-subtle">
      <StatusDot tone={llm.ok ? "success" : "danger"} />
      {llm.ok ? `Connected: ${llm.model} answers at ${llm.url}` : `Not answering: ${llm.model} at ${llm.url}`}
    </p>
  )
}

export type LocalServerProps = {
  url: string
  onUrl: (url: string) => void
  /** A key was saved earlier. It is never sent back, so the field starts empty and "" keeps it. */
  keySaved: boolean
  apiKey: string
  onApiKey: (key: string) => void
  servers: LocalServerInfo[] | undefined
  scan: { busy: boolean; note: string | null }
  /** Ask the server at this address what it offers now. */
  onRescan: (address: string) => void
}

/** This Mac's model server: its address (a known server reads by name, its address while editing), the
 * usual servers to pick from, a rescan, and the API key for a server that asks for one. */
export function LocalServer({
  url,
  onUrl,
  keySaved,
  apiKey,
  onApiKey,
  servers,
  scan,
  onRescan,
}: LocalServerProps) {
  const [editing, setEditing] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const known = servers?.find((s) => s.url === url.trim())
  return (
    <>
      <div className="flex flex-col gap-1">
        <Field label="Model server">
          <Input
            // A known server reads by name ("MTPLX / vLLM · 8000"); editing shows its address.
            value={known && !editing ? `${known.name} · ${known.port}` : url}
            title={url}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="1235, or 10.0.0.8:1234"
            spellCheck={false}
          />
        </Field>
        <Button
          size="sm"
          disabled={scan.busy || !url.trim()}
          onClick={() => onRescan(url)}
          title="Ask this server which models it offers now"
          className="self-start"
        >
          {scan.busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{" "}
          Rescan
        </Button>
        <ServerPick
          label="Common servers"
          servers={servers}
          selected={url}
          onPick={(address) => {
            onUrl(address)
            onRescan(address)
          }}
        />
        <ServerStatus scanned={scan.note} />
        {scan.note && (
          <p role="status" className="text-12 text-ink-subtle">
            {scan.note}
          </p>
        )}
      </div>
      {keySaved && !replacing && !apiKey ? (
        <div className="flex items-center gap-2.5">
          <span className="text-13 font-semibold">API key</span>
          <span role="status" className="text-12 text-ink-subtle">
            Key saved
          </span>
          <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
            Replace
          </Button>
        </div>
      ) : (
        <Field label="API key">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => onApiKey(e.target.value)}
            placeholder={
              keySaved ? "Type a new key to replace the saved one" : "Only for a server that asks for one"
            }
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
    </>
  )
}
