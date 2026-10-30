import { useState } from "react"
import { useMics, useSetAudioMonitor, useUpdateMic } from "@troubadour/api/audio"
import type { MicCapsule, MicCheck, MicInfo, MicPattern, MicSpecsPatch } from "@troubadour/api/audio"
import { useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"
import { Card, CardBody, CardHeader } from "@troubadour/ui/card"
import { cn } from "@troubadour/ui/cn"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { NativeSelect } from "@troubadour/ui/native-select"
import { Switch } from "@troubadour/ui/switch"
import { Textarea } from "@troubadour/ui/textarea"

const PATTERNS: { value: MicPattern; label: string }[] = [
  { value: "omni", label: "Omni" },
  { value: "cardioid", label: "Cardioid" },
  { value: "supercardioid", label: "Supercardioid" },
  { value: "hypercardioid", label: "Hypercardioid" },
  { value: "figure-8", label: "Figure-8" },
  { value: "stereo", label: "Stereo" },
  { value: "boundary", label: "Boundary" },
  { value: "beamforming", label: "Beamforming" },
]

const CAPSULES: { value: MicCapsule; label: string }[] = [
  { value: "condenser", label: "Condenser" },
  { value: "dynamic", label: "Dynamic" },
  { value: "array", label: "Mic array" },
]

/** One line of advice for the first failing check (in order of importance). */
const ADVICE: Record<MicCheck["id"], string> = {
  around:
    "This mic is built for one voice up close. For the middle of a table, use an omnidirectional or boundary mic, or switch this one to omni if it can.",
  distance:
    "This mic needs people close to it. Put it in the middle of the table, or use one made to pick up a room.",
  wired: "Bluetooth squeezes the mic's sound. Use a wired (USB) mic, or the mic on the computer.",
  rate: "Set this input to 48 kHz (or 44.1 kHz) in Audio MIDI Setup.",
  measured: "Past sessions with this mic sounded poor. Open them under Sessions → Audio to see why.",
}
const ADVICE_ORDER: MicCheck["id"][] = ["around", "distance", "wired", "rate", "measured"]

function SpecsForm({ mic }: { mic: MicInfo }) {
  const update = useUpdateMic()
  const [model, setModel] = useState(mic.specs.model ?? "")
  const [capsule, setCapsule] = useState<MicCapsule | "">(mic.specs.capsule ?? "")
  const [patterns, setPatterns] = useState<MicPattern[]>(mic.specs.patterns ?? [])
  const [wireless, setWireless] = useState(mic.specs.wireless ?? false)
  const [notes, setNotes] = useState(mic.specs.notes ?? "")

  const toggle = (p: MicPattern) =>
    setPatterns((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))

  return (
    <form
      aria-label="Microphone specs"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const patch: MicSpecsPatch = { patterns, wireless, notes: notes.trim() }
        if (model.trim()) patch.model = model.trim()
        if (capsule) patch.capsule = capsule
        update.mutate({ name: mic.name, patch })
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model">
          <Input placeholder="e.g. Yeti GX" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="Capsule">
          <NativeSelect value={capsule} onChange={(e) => setCapsule(e.target.value as MicCapsule | "")}>
            <option value="">Not sure</option>
            {CAPSULES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-12 text-ink-subtle">Pickup patterns</span>
        <div role="group" aria-label="Pickup patterns" className="flex flex-wrap gap-1.5">
          {PATTERNS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={patterns.includes(p.value)}
              onClick={() => toggle(p.value)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-12 transition-colors",
                patterns.includes(p.value)
                  ? "bg-accent-strong text-white"
                  : "bg-sunken text-ink-subtle hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-13">
        <Switch checked={wireless} onCheckedChange={setWireless} aria-label="Wireless" />
        Wireless
      </label>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={update.isPending}>
          Save
        </Button>
        {update.isError && <span className="text-12 text-danger">Could not save. Try again.</span>}
      </div>
    </form>
  )
}

function MonitorSwitch() {
  const monitor = useLive((s) => s.session?.audio_monitor ?? true)
  const set = useSetAudioMonitor()
  // The live store is the source of truth; show the choice at once while the server catches up.
  const on = set.isPending ? set.variables : monitor
  return (
    <label className="flex items-center gap-3 border-t border-line pt-4 text-13">
      <Switch
        checked={on}
        onCheckedChange={(v) => set.mutate(v)}
        aria-label="Monitor the level during sessions"
      />
      <span className="flex flex-col">
        Monitor the level during sessions
        <span className="text-12 text-ink-subtle">Turn off to skip the live level and quality read-out.</span>
      </span>
    </label>
  )
}

/** What Troubadour knows about the selected mic: its specs (editable), and advice for the first failing check. */
export function MicDetails({ device }: { device: string | null }) {
  const mics = useMics()
  const list = mics.data ?? []
  const mic =
    list.find((m) => m.name === device) ?? (device == null ? list.find((m) => m.default) : undefined)
  const failing = mic && ADVICE_ORDER.find((id) => mic.checks.some((c) => c.id === id && c.ok === false))
  const maker = mic && [mic.maker, mic.connection].filter(Boolean).join(" · ")

  return (
    <Card aria-label="This microphone">
      <CardHeader title="This microphone" meta={maker} />
      <CardBody className="flex flex-col gap-4">
        {mics.isPending ? (
          <p className="text-13 text-ink-subtle">Checking the microphone…</p>
        ) : mic ? (
          <>
            {failing && (
              <p role="note" className="rounded-control bg-warning-soft px-3 py-2 text-13 text-warning">
                {ADVICE[failing]}
              </p>
            )}
            {/* Keyed so the form restarts from the saved specs when another mic is picked. */}
            <SpecsForm key={mic.name} mic={mic} />
          </>
        ) : (
          <p className="text-13 text-ink-subtle">No microphone found.</p>
        )}
        <MonitorSwitch />
      </CardBody>
    </Card>
  )
}
