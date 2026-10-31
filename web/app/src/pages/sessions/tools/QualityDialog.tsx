import { CircleCheck, HelpCircle, Mic, SlidersHorizontal } from "lucide-react"
import { useSessionQuality, type RecordingQuality, type SavedSession } from "@troubadour/api/sessions"
import { QUALITY_ROWS } from "@troubadour/api/live"
import type { Grade } from "@troubadour/api/audio"
import { cn } from "@troubadour/ui/cn"
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@troubadour/ui/dialog"
import { Spinner } from "@troubadour/ui/spinner"

export type QualityDialogProps = {
  session: SavedSession
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const VERDICT = {
  good: { title: "This mic setup works", icon: CircleCheck, banner: "bg-success-soft text-success" },
  settings: { title: "Change mic settings", icon: SlidersHorizontal, banner: "bg-warning-soft text-warning" },
  microphone: {
    title: "Consider a different microphone",
    icon: Mic,
    banner: "bg-danger-soft text-danger",
  },
  unknown: {
    title: "Not enough speech to judge this recording",
    icon: HelpCircle,
    banner: "bg-elevated text-ink-muted",
  },
} as const

const GRADE: Record<Grade, { label: string; dot: string }> = {
  good: { label: "good", dot: "bg-success" },
  ok: { label: "OK", dot: "bg-warning" },
  poor: { label: "poor", dot: "bg-danger" },
}

export function QualityDialog({ session, open, onOpenChange }: QualityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Recording quality" description="How well the mic heard this session." />
        <DialogBody>{open ? <Report sessionId={session.id} /> : null}</DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// Mounted only while open, so the measurement (a few seconds the first time) runs on demand.
function Report({ sessionId }: { sessionId: string }) {
  const { data: q, error, isPending } = useSessionQuality(sessionId)
  if (isPending)
    return (
      <p className="flex items-center gap-2 text-ink-muted">
        <Spinner /> Measuring the recording… (a few seconds the first time)
      </p>
    )
  if (error)
    return (
      <p role="alert" className="text-danger">
        Couldn't measure this recording: {error.message}
      </p>
    )
  const verdict = VERDICT[q.verdict.kind]
  const Icon = verdict.icon
  return (
    <div className="flex flex-col gap-5" data-testid="recording-quality">
      <div role="status" className={cn("flex flex-col gap-1 rounded-card p-3.5", verdict.banner)}>
        <p className="flex items-center gap-2 font-semibold">
          <Icon className="size-4 shrink-0" /> {verdict.title}
        </p>
        {q.verdict.reasons.length > 0 && (
          <ul className="list-disc pl-6 text-13">
            {q.verdict.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {q.mic && <p className="text-12 opacity-80">Mic: {q.mic}</p>}
      </div>

      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 text-13">
        {QUALITY_ROWS.map((row) => {
          const grade = GRADE[q.overall.grades[row.key]]
          return (
            <div key={row.key} data-quality={row.key} className="contents">
              <span
                aria-label={`Grade: ${grade.label}`}
                title={grade.label}
                className={cn("size-2 rounded-full", grade.dot)}
              />
              <dt className="text-ink-muted">{row.label}</dt>
              <dd className="text-right tabular-nums">{row.value(q.overall)}</dd>
            </div>
          )
        })}
      </dl>

      {q.timeline.length > 0 && <Timeline points={q.timeline} />}
      {q.speakers.length > 0 && <SpeakerLevels speakers={q.speakers} spread={q.spread_db} />}
    </div>
  )
}

const W = 280
const H = 80
const STRIP = 12
const DB_MIN = -80

/** Speech and noise per minute as two lines with the gap (SNR) shaded, and rumble as a strip below. */
function Timeline({ points }: { points: RecordingQuality["timeline"] }) {
  const n = points.length
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (db: number) => (Math.min(0, Math.max(DB_MIN, db)) / DB_MIN) * H
  const line = (key: "speech_db" | "noise_db") => points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ")
  const band = [
    ...points.map((p, i) => `${x(i)},${y(p.speech_db)}`),
    ...points.map((p, i) => `${x(i)},${y(p.noise_db)}`).reverse(),
  ].join(" ")
  const minutes = Math.round(points[n - 1]!.t / 60)
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex items-center gap-3 text-12 text-ink-subtle">
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded bg-success" /> Speech
        </span>
        <span className="flex items-center gap-1">
          <span className="h-0.5 w-3 rounded bg-ink-subtle" /> Noise
        </span>
        <span className="ml-auto">per minute</span>
      </figcaption>
      <svg
        role="img"
        aria-label="Speech and noise level per minute, with low rumble underneath"
        viewBox={`0 0 ${W} ${H + 4 + STRIP}`}
        className="w-full overflow-visible"
        preserveAspectRatio="none"
      >
        {[-20, -40, -60].map((db) => (
          <line key={db} x1={0} x2={W} y1={y(db)} y2={y(db)} className="stroke-line" strokeDasharray="2 3" />
        ))}
        <polygon points={band} className="fill-success-soft" />
        <polyline points={line("noise_db")} fill="none" className="stroke-ink-subtle" strokeWidth={1.5} />
        <polyline points={line("speech_db")} fill="none" className="stroke-success" strokeWidth={1.5} />
        {points.map((p, i) => {
          const h = (Math.min(100, Math.max(0, p.rumble_pct)) / 100) * STRIP
          return (
            <rect
              key={i}
              data-rumble={i}
              x={n === 1 ? 0 : (i / n) * W}
              width={Math.max(1, W / n - 1)}
              y={H + 4 + STRIP - h}
              height={h}
              className={
                p.rumble_pct >= 50 ? "fill-danger" : p.rumble_pct >= 20 ? "fill-warning" : "fill-line"
              }
            >
              <title>{`Minute ${Math.round(p.t / 60) + 1}: ${p.rumble_pct.toFixed(0)}% rumble`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="flex justify-between text-11 text-ink-subtle tabular-nums">
        <span>0 min</span>
        <span>Low rumble</span>
        <span>{minutes} min</span>
      </div>
    </figure>
  )
}

/** How loud each named player comes through; a big spread means some voices are hard to hear. */
function SpeakerLevels({ speakers, spread }: { speakers: RecordingQuality["speakers"]; spread: number }) {
  const width = (db: number) => Math.min(100, Math.max(4, ((db + 60) / 60) * 100))
  const loudest = speakers[0]!
  const quietest = speakers[speakers.length - 1]!
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-12 font-semibold text-ink-subtle">Loudness by player</h4>
      <ul aria-label="Loudness by player" className="flex flex-col gap-1.5">
        {speakers.map((s) => (
          <li
            key={s.speaker}
            data-speaker={s.speaker}
            className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-2 text-13"
          >
            <span className="truncate">{s.speaker}</span>
            <span className="h-2 rounded-full bg-elevated">
              <span className="block h-2 rounded-full bg-accent" style={{ width: `${width(s.level_db)}%` }} />
            </span>
            <span className="text-right tabular-nums">{s.level_db.toFixed(0)} dB</span>
          </li>
        ))}
      </ul>
      {speakers.length > 1 && Math.round(spread) >= 1 && (
        <p className="text-12 text-ink-subtle">
          {quietest.speaker} comes through {Math.round(spread)} dB quieter than {loudest.speaker}.
        </p>
      )}
    </section>
  )
}
