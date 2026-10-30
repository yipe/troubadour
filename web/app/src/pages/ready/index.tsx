import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { TriangleAlert } from "lucide-react"
import { useMics } from "@troubadour/api/audio"
import { useLive } from "@troubadour/api/live"
import { useSources, useStartSession, type Source } from "@troubadour/api/session"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import { PageHeading } from "@troubadour/ui/page-heading"
import { notify } from "@troubadour/ui/toast"
import { MicCard } from "../../components/mic/MicCard.tsx"
import { nextSessionNumber } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { ModelTiles } from "./ModelTiles.tsx"
import { useIdleSourcesPoll } from "./polling.ts"
import { PreviouslyOn } from "./PreviouslyOn.tsx"
import { readSavedMic, saveMic } from "./savedMic.ts"
import { StartCard, type StartChoices } from "./StartCard.tsx"
import { useModelTiles } from "./useModelTiles.ts"
import { WhoIsHere } from "./WhoIsHere.tsx"

interface Problem {
  label: string
  detail?: string
}

export function Component() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const players = useLive((s) => s.players)
  const status = useLive((s) => s.session?.status ?? "idle")
  const serverError = useLive((s) => s.session?.error ?? null)
  const sessions = useSessions().data
  const sources = useSources().data
  const mics = useMics().data
  const tiles = useModelTiles()
  const start = useStartSession()

  const [savedMic] = useState(readSavedMic)
  const [picked, setPicked] = useState<Source | null>(null)
  const [absent, setAbsent] = useState<ReadonlySet<string>>(new Set())
  const [choices, setChoices] = useState<StartChoices>({
    title: "",
    recordAudio: true,
    cleanup: true,
    consent: false,
  })
  const [problems, setProblems] = useState<Problem[] | null>(null)

  const idle = status === "idle"
  useIdleSourcesPoll(idle)

  // `?source=file` (from Home's replay link) opens with the first sample file chosen, until the user picks.
  const firstFile = sources?.files[0]?.name
  const device: Source =
    picked ??
    (params.get("source") === "file" && firstFile
      ? { kind: "file", name: firstFile, speed: 1 }
      : { kind: "mic", device: savedMic })

  const changeDevice = (next: Source) => {
    setPicked(next)
    if (next.kind === "mic") saveMic(next.device ?? null)
  }

  const toggle = (id: string) =>
    setAbsent((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  /** A remembered mic that was unplugged falls back to the default instead of failing the start. */
  const sourceToStart = (): Source => {
    if (device.kind === "mic" && device.device && mics && !mics.some((m) => m.name === device.device)) {
      return { kind: "mic", device: null }
    }
    return device
  }

  const redChecks = (): Problem[] => {
    const found: Problem[] = []
    if (device.kind === "mic") {
      const mic = mics?.find((m) => (device.device ? m.name === device.device : m.default))
      for (const c of mic?.checks ?? []) if (c.ok === false) found.push({ label: c.label, detail: c.detail })
    }
    for (const t of tiles) {
      if (t.tone !== "success") found.push({ label: `${t.title}: ${t.status}` })
    }
    return found
  }

  const begin = () => {
    start.mutate(
      {
        source: sourceToStart(),
        title: choices.title.trim(),
        present_player_ids: players.filter((p) => !absent.has(p.id)).map((p) => p.id),
        record_audio: choices.recordAudio,
        cleanup: choices.cleanup,
      },
      {
        onSuccess: () => void navigate(paths.live()),
        onError: (e) => notify(e.message, { tone: "danger" }),
      },
    )
  }

  const requestStart = () => {
    const red = redChecks()
    if (red.length > 0) setProblems(red)
    else begin()
  }

  const n = nextSessionNumber(sessions ?? [])
  const lastWriteUp = sessions?.find((s) => s.summary?.trim())

  if (!idle) {
    return (
      <div className="flex flex-col items-start gap-3 p-10">
        <PageHeading title="Session in progress" subtitle="The table is being transcribed right now." />
        <Button variant="primary" nativeButton={false} render={<Link to={paths.live()} />}>
          Go to session
        </Button>
      </div>
    )
  }

  return (
    <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_400px] gap-6 px-10 py-7">
      <section className="flex flex-col gap-4">
        <PageHeading
          title={`Session ${n} · ready check`}
          subtitle="Three things to confirm before the dice come out. Each one fixes itself if you skip it, it just gets less accurate."
        />
        <WhoIsHere players={players} absent={absent} onToggle={toggle} />
        <MicCard mode="ready" device={device} onDeviceChange={changeDevice} sources={sources} />
        <ModelTiles tiles={tiles} />
      </section>
      <aside className="flex flex-col gap-4">
        <StartCard
          value={choices}
          onChange={setChoices}
          titlePlaceholder={`Session ${n} (the write-up names it)`}
          busy={start.isPending}
          blocked={serverError !== null}
          onStart={requestStart}
        />
        <PreviouslyOn session={lastWriteUp} />
      </aside>
      <ConfirmDialog
        open={problems !== null}
        onOpenChange={(open) => !open && setProblems(null)}
        title="Start anyway?"
        tone="primary"
        confirmLabel="Start anyway"
        onConfirm={() => {
          setProblems(null)
          begin()
        }}
        body={
          <>
            <p className="flex items-center gap-2">
              <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
              Troubadour will still work, but quieter or far-away players get fewer words and more wrong
              names.
            </p>
            <ul aria-label="Red checks" className="mt-3 space-y-1.5">
              {problems?.map((p) => (
                <li key={p.label}>
                  {p.label}
                  {p.detail && <span className="block text-12 text-ink-subtle">{p.detail}</span>}
                </li>
              ))}
            </ul>
          </>
        }
      />
    </main>
  )
}
