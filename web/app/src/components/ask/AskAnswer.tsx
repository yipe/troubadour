import type { ReactNode } from "react"
import type { AnswerSource, CampaignAnswer } from "@troubadour/api/ask"
import { useSessions } from "@troubadour/api/sessions"
import { cn } from "@troubadour/ui/cn"
import { Spinner } from "@troubadour/ui/spinner"
import { TimestampLink } from "../audio/TimestampLink.tsx"
import { EntityLink } from "../entity/EntityLink.tsx"
import { PlayerAvatar } from "../people/PlayerAvatar.tsx"
import { parseAnswer } from "./citations.ts"

export type AskAnswerProps = {
  answer: CampaignAnswer
  /** Called when a source row is opened or played. */
  onSource: (source: AnswerSource) => void
  compact?: boolean
  /** Shown under the message when the answer failed. */
  retry?: ReactNode
}

function Progress({ answer }: { answer: CampaignAnswer }) {
  const { state, stats } = answer
  const text =
    state === "thinking"
      ? "Thinking…"
      : stats
        ? `Searching ${stats.transcripts} transcripts and ${stats.notes} notes on this Mac…`
        : "Searching…"
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-14 text-ink-muted">
      <Spinner />
      {text}
    </p>
  )
}

function SourceRow({
  number,
  source,
  onSource,
}: {
  number: number
  source: AnswerSource
  onSource: (source: AnswerSource) => void
}) {
  const sessions = useSessions().data
  const session = source.session ? sessions?.find((s) => s.id === source.session) : undefined
  const who = source.kind === "transcript" ? source.label.split(" · ")[0] : undefined
  return (
    <li className="flex gap-3 rounded-card border border-line bg-surface px-3.5 py-3">
      <span className="font-mono text-13 text-accent">{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-12 text-ink-subtle">
          {who ? <PlayerAvatar name={who} size={24} /> : null}
          <span>{source.label}</span>
          <span className="ml-auto whitespace-nowrap">
            {source.kind === "transcript" && source.session && source.t !== null ? (
              <TimestampLink
                sessionId={source.session}
                t={source.t}
                label="Play line"
                hasAudio={session?.audio ?? false}
                onJump={() => onSource(source)}
              />
            ) : source.entry ? (
              <EntityLink name={source.entry}>Open note</EntityLink>
            ) : (
              <button type="button" className="text-accent hover:underline" onClick={() => onSource(source)}>
                Open note
              </button>
            )}
          </span>
        </div>
        <p className="text-14 text-pretty text-ink-muted">{source.excerpt}</p>
      </div>
    </li>
  )
}

/** A campaign answer in its four states, with numbered sources under it. */
export function AskAnswer({ answer, onSource, compact = false, retry }: AskAnswerProps) {
  if (answer.state === "error") {
    return (
      <div role="alert" className="flex flex-col gap-2 text-14 text-danger">
        <p>{answer.message || "Something went wrong answering that."}</p>
        {retry}
      </div>
    )
  }
  if (answer.state !== "done") return <Progress answer={answer} />

  const { pieces, ordered } = parseAnswer(answer.answer, answer.sources)
  const { stats } = answer
  return (
    <div className="flex flex-col gap-4">
      {answer.found ? (
        <p
          className={cn("font-serif text-pretty", compact ? "text-18 leading-snug" : "text-24 leading-snug")}
        >
          {pieces.map((p, i) =>
            p.kind === "cite" ? (
              <sup key={i} aria-label={`Source ${p.number}`} className="ml-0.5 text-13 text-accent">
                {p.number}
              </sup>
            ) : p.kind === "quote" ? (
              <span key={i} className="rounded-[3px] bg-accent-soft px-1">
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
      ) : (
        <p className={cn("font-serif text-ink-muted", compact ? "text-18" : "text-24")}>
          The notes don't say.
        </p>
      )}
      {ordered.length > 0 ? (
        <ol aria-label="Sources" className="flex flex-col gap-2">
          {ordered.map((o) => (
            <SourceRow key={o.source.id} number={o.number} source={o.source} onSource={onSource} />
          ))}
        </ol>
      ) : null}
      {stats ? (
        <p className="text-12 text-ink-subtle">
          Answered on this Mac in {Math.round(stats.seconds)} s from {stats.transcripts} transcripts and{" "}
          {stats.notes} notes
        </p>
      ) : null}
    </div>
  )
}
