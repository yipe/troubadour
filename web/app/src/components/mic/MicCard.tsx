import { useEffect, useState } from "react"
import { Check, Mic, Square } from "lucide-react"
import { stopMicTest, useMics, useStartMicTest, useStopMicTest } from "@troubadour/api/audio"
import { useAudio, useLive } from "@troubadour/api/live"
import type { Source, SourceList } from "@troubadour/api/session"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { NativeSelect } from "@troubadour/ui/native-select"
import { LevelMeter48 } from "./LevelMeter48.tsx"
import { checklistRows } from "./checklistRows.ts"
import { MicChecklist } from "./MicChecklist.tsx"

export type MicCardMode = "ready" | "wizard" | "settings"

export interface MicCardProps {
  mode: MicCardMode
  /** What the session will listen to. Only `ready` lets it be a replayed file or session. */
  device: Source
  onDeviceChange: (source: Source) => void
  /** Sample files the server can replay (ready mode). */
  sources?: SourceList
}

const STATUS_CLASS = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-sunken text-ink-subtle",
} as const

const FILE = "file:"
const SAVED = "session:"
const MIC = "mic:"

function valueOf(device: Source, defaultMic: string | undefined): string {
  if (device.kind === "file") return FILE + device.name
  if (device.kind === "session") return SAVED + device.id
  return MIC + (device.device ?? defaultMic ?? "")
}

/** Saved sessions that can be replayed. Its own component so the list is only fetched in ready mode. */
function SavedSessionOptions() {
  const sessions = useSessions()
  const replayable = (sessions.data ?? []).filter((s) => s.replayable)
  if (replayable.length === 0) return null
  return (
    <optgroup label="Replay a saved session…">
      {replayable.map((s) => (
        <option key={s.id} value={SAVED + s.id}>
          {new Date(s.started_at * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
        </option>
      ))}
    </optgroup>
  )
}

function TestControl({ device }: { device: string | null }) {
  const running = useAudio((s) => s.micTest === "running")
  const start = useStartMicTest()
  const stop = useStopMicTest()
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])

  // Don't leave the mic open when the card goes away (a session starting, navigating off).
  useEffect(
    () => () => {
      if (useAudio.getState().micTest === "running") void stopMicTest().catch(() => {})
    },
    [],
  )

  const busy = start.isPending || stop.isPending
  const left = endsAt == null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000))

  return (
    <div className="flex items-center gap-2">
      {running ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            stop.mutate(undefined, { onSuccess: () => useAudio.setState({ micTest: "stopped" }) })
          }
        >
          <Square className="size-3" /> Stop
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            start.mutate(
              { device },
              {
                onSuccess: (res) => {
                  setEndsAt(Date.now() + res.seconds * 1000)
                  setNow(Date.now())
                  useAudio.setState((s) => ({
                    micTest: "running",
                    quality: { ...s.quality, test: undefined },
                  }))
                },
              },
            )
          }
        >
          <Mic className="size-3" /> Test
        </Button>
      )}
      {running && left != null && (
        <span data-testid="mic-test-countdown" className="text-12 text-ink-subtle tabular-nums">
          {left}s
        </span>
      )}
    </div>
  )
}

export function MicCard({ mode, device, onDeviceChange, sources }: MicCardProps) {
  const mics = useMics()
  const sessionRunning = useLive((s) => (s.session?.status ?? "idle") !== "idle")
  const source = sessionRunning ? "session" : "test"
  const quality = useAudio((s) => s.quality[source])

  const micList = mics.data ?? []
  const defaultMic = micList.find((m) => m.default)?.name
  const micName = device.kind === "mic" ? (device.device ?? defaultMic) : undefined
  const selectedMic = micList.find((m) => m.name === micName)
  const rows = checklistRows(selectedMic?.checks ?? [], quality)

  const failing = rows.some((r) => r.tone === "warn")
  const status = quality === undefined ? "neutral" : failing ? "warning" : "success"

  const change = (value: string) => {
    if (value.startsWith(FILE)) {
      const name = value.slice(FILE.length)
      const speed = device.kind === "file" || device.kind === "session" ? device.speed : 1
      onDeviceChange({ kind: "file", name, speed })
    } else if (value.startsWith(SAVED)) {
      const speed = device.kind === "file" || device.kind === "session" ? device.speed : 1
      onDeviceChange({ kind: "session", id: value.slice(SAVED.length), speed })
    } else {
      const name = value.slice(MIC.length)
      onDeviceChange({ kind: "mic", device: name === defaultMic ? null : name })
    }
  }

  const files = mode === "ready" ? (sources?.files ?? []) : []

  return (
    <section
      aria-label="Microphone"
      className="flex flex-col gap-3.5 rounded-card border border-line bg-surface px-[18px] py-4"
    >
      <div className="flex items-center gap-2.5">
        <span
          data-testid="mic-status"
          data-status={status}
          className={`flex size-[22px] items-center justify-center rounded-full text-12 font-bold ${STATUS_CLASS[status]}`}
        >
          {status === "success" ? <Check className="size-3" aria-hidden /> : status === "warning" ? "!" : ""}
        </span>
        <h3 className="font-bold">Microphone</h3>
        <div className="ml-auto min-w-[280px]">
          <NativeSelect
            aria-label="Microphone"
            value={valueOf(device, defaultMic)}
            onChange={(e) => change(e.target.value)}
          >
            {device.kind === "mic" && micName && !selectedMic && (
              <option value={MIC + micName}>{micName}</option>
            )}
            {micList.map((m) => (
              <option key={m.name} value={MIC + m.name}>
                {m.default ? `${m.name} (default)` : m.name}
              </option>
            ))}
            {files.length > 0 && (
              <optgroup label="Replay a file…">
                {files.map((f) => (
                  <option key={f.name} value={FILE + f.name}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
            {mode === "ready" && <SavedSessionOptions />}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-center gap-5">
        <div className="flex flex-col gap-2">
          <LevelMeter48 key={source} source={source} />
          {!sessionRunning && <TestControl device={device.kind === "mic" ? device.device : null} />}
        </div>
        <MicChecklist rows={rows} />
      </div>
    </section>
  )
}
