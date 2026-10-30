import { toPng } from "html-to-image"
import { Copy, EyeOff, ImageDown } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router"
import { useRecap, useBuildRecap } from "@troubadour/api/recap"
import type { RecapInclude, RecapOptions, RecapVoice } from "@troubadour/api/recap"
import { useCampaigns } from "@troubadour/api/campaigns"
import { useClasses } from "@troubadour/api/players"
import { useSessionRecord, useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { Checkbox } from "@troubadour/ui/checkbox"
import { cn } from "@troubadour/ui/cn"
import { PageHeading } from "@troubadour/ui/page-heading"
import { Slider } from "@troubadour/ui/slider"
import { Spinner } from "@troubadour/ui/spinner"
import { notify } from "@troubadour/ui/toast"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { useJob } from "../../components/jobs/useJob.ts"
import { ReadAloud } from "../../components/read-aloud/ReadAloud.tsx"
import { playerColor } from "../../lib/players.ts"
import { sessionNumbers } from "../../lib/sessions.ts"
import { paths } from "../../paths.ts"
import { discordMarkdown } from "./discord.ts"
import { RecapCard, type CardPlayer } from "./RecapCard.tsx"

const DEFAULTS: RecapOptions = {
  voice: "narrator",
  length_s: 45,
  include: { happened: true, quote: true, moments: true, questions: false },
}
const VOICES: { id: RecapVoice; label: string }[] = [
  { id: "narrator", label: "Narrator" },
  { id: "chronicle", label: "In-world chronicle" },
  { id: "bullets", label: "Bullet notes" },
]
const INCLUDES: { key: keyof RecapInclude; label: string }[] = [
  { key: "happened", label: "What happened" },
  { key: "quote", label: "One quote of the night" },
  { key: "moments", label: "A moment for each player" },
  { key: "questions", label: "Open questions for next time" },
]
/** Option changes rebuild once the owner stops fiddling; each build is an LLM call. */
const REBUILD_MS = 600

export function Component() {
  const { id = "" } = useParams()
  const recap = useRecap(id).data
  const build = useBuildRecap(id)
  const { job, active } = useJob("recap", id)
  const sessions = useSessions().data
  const record = useSessionRecord(id).data
  const classes = useClasses().data ?? []
  const campaigns = useCampaigns().data
  const [edited, setEdited] = useState<RecapOptions | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const options = edited ?? recap?.options ?? DEFAULTS
  const summary = sessions?.find((s) => s.id === id)
  const reviewed = !summary || !!summary.reviewed_at
  const campaignName = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)?.name
  const number = useMemo(() => sessionNumbers(sessions ?? []).get(id), [sessions, id])
  const sessionLabel = number ? `Session ${number}` : "Session"

  const players: CardPlayer[] = useMemo(
    () => (record?.players ?? []).map((p) => ({ id: p.id, name: p.name, color: playerColor(p, classes) })),
    [record, classes],
  )

  function change(next: RecapOptions) {
    setEdited(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => build.mutate(next), REBUILD_MS)
  }

  function copyForDiscord() {
    if (!recap) return
    const names = new Map(players.map((p) => [p.id, p.name]))
    void navigator.clipboard.writeText(discordMarkdown(recap, names)).then(
      () => notify("Copied"),
      () => notify("Couldn't copy", { tone: "danger" }),
    )
  }

  async function saveImage() {
    if (!cardRef.current) return
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 2 })
      const a = document.createElement("a")
      a.href = url
      a.download = `${sessionLabel} recap.png`
      a.click()
    } catch {
      notify("Couldn't save the image", { tone: "danger" })
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[440px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-[18px] overflow-y-auto border-r border-line p-6">
        <PageHeading title="Share the recap" subtitle={`${sessionLabel} · built from reviewed facts only`} />
        {!reviewed && (
          <p role="status" className="rounded-card border border-warning/30 bg-warning-faint p-3 text-13">
            <Link to={paths.review(id)} className="font-semibold text-accent underline">
              Review {sessionLabel.toLowerCase()} first
            </Link>
            : the recap only uses reviewed facts
          </p>
        )}
        <div role="radiogroup" aria-label="Voice" className="flex flex-col gap-1.5">
          <span className="text-12 text-ink-subtle">Voice</span>
          <div className="flex h-[34px] overflow-hidden rounded-control border border-line text-13">
            {VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={options.voice === v.id}
                onClick={() => change({ ...options, voice: v.id })}
                className={cn(
                  "flex-1 cursor-pointer border-l border-line first:border-l-0",
                  options.voice === v.id ? "bg-accent-soft font-semibold text-accent" : "text-ink-muted",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex text-12 text-ink-subtle">
            <span id="recap-length">Length</span>
            <span className="ml-auto">About {options.length_s} seconds read</span>
          </div>
          <Slider
            aria-labelledby="recap-length"
            min={15}
            max={120}
            step={5}
            value={options.length_s}
            onValueChange={(v) => change({ ...options, length_s: Array.isArray(v) ? (v[0] ?? 45) : v })}
          />
        </div>
        <div className="flex flex-col gap-2.5 text-13">
          <span className="text-12 text-ink-subtle">Include</span>
          {INCLUDES.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5">
              <Checkbox
                checked={options.include[key]}
                onCheckedChange={(on) => change({ ...options, include: { ...options.include, [key]: on } })}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="flex gap-2.5 rounded-card border border-info/30 bg-info-faint p-3 text-13">
          <EyeOff size={16} className="shrink-0 text-info" aria-hidden />
          <span>Party theories are worded as theories. Nothing from unreviewed suggestions is included.</span>
        </p>
        <div className="flex-1" />
        <div className="grid grid-cols-2 gap-2">
          <ReadAloud sessionId={id} text={recap?.body ?? ""} />
          <Button size="lg" disabled={!recap} onClick={copyForDiscord}>
            <Copy size={14} />
            Copy for Discord
          </Button>
          <Button size="lg" variant="primary" className="col-span-2" disabled={!recap} onClick={saveImage}>
            <ImageDown size={14} />
            Save image
          </Button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center gap-4 overflow-auto bg-sunken p-8">
        {job && <JobStatus job={job} variant="inline" />}
        {build.isError && (
          <p role="alert" className="text-13 text-danger">
            {build.error.message}
          </p>
        )}
        {recap ? (
          <RecapCard
            recap={recap}
            label={[campaignName, sessionLabel].filter(Boolean).join(" · ")}
            players={players}
            cardRef={cardRef}
          />
        ) : active || build.isPending ? (
          <Spinner />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center text-ink-muted">
            <p>No recap yet. Pick the options, then build it.</p>
            <Button variant="primary" onClick={() => build.mutate(options)}>
              Build recap
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}
