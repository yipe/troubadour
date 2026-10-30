import type { CSSProperties, ReactNode } from "react"
import { Badge } from "@troubadour/ui/badge"
import { cn } from "@troubadour/ui/cn"
import type { EntityType } from "@troubadour/api/campaign"
import { type Confidence } from "../../lib/confidence.ts"
import { hms } from "../../lib/format.ts"
import { TimestampLink } from "../audio/TimestampLink.tsx"
import { ConfidenceBadge } from "../entity/ConfidenceBadge.tsx"

export type SuggestionKind = "fact" | "update" | "entry" | "spelling" | "pin"

const KIND: Record<SuggestionKind, { label: string; className: string }> = {
  fact: { label: "Fact", className: "text-accent" },
  update: { label: "Updates a fact", className: "text-info" },
  entry: { label: "New entry", className: "text-very-rare" },
  spelling: { label: "Spelling", className: "text-info" },
  pin: { label: "Note", className: "text-ink-muted" },
}

export type SuggestionCardProps = {
  kind: SuggestionKind
  /** The entry the suggestion is about. */
  about?: string
  entryType?: EntityType
  text: string
  /** The fact an "update" replaces: shown struck through above the new text. */
  old?: string
  confidence?: Confidence
  who?: { name: string; color: string }
  /** Session seconds of the moment it came from. */
  t?: number
  sessionId?: string
  /** The session's number and recording, when known, for the timestamp link. */
  sessionN?: number
  hasAudio?: boolean
  status: "open" | "done"
  tone?: "default" | "accepted"
  actions: ReactNode
  onJump?: (t: number) => void
}

/** One thing the notebook or the review wants a yes or no on. Callers fill `actions`. */
export function SuggestionCard(p: SuggestionCardProps) {
  const kind = KIND[p.kind]
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-card border bg-surface px-3.5 py-3",
        p.tone === "accepted"
          ? "border-success"
          : p.kind === "update" && p.status === "open"
            ? "border-info"
            : "border-line",
        p.status === "done" && "opacity-75",
      )}
    >
      <div className="flex items-center gap-2 text-12">
        <span className={cn("font-bold", kind.className)}>{kind.label}</span>
        {p.about ? (
          <span className="text-ink-muted">
            → {p.about}
            {p.entryType ? <span className="text-ink-subtle"> · {p.entryType}</span> : null}
          </span>
        ) : null}
        <span className="ml-auto">
          {p.kind === "spelling" ? (
            <Badge tone="info">Spelling</Badge>
          ) : p.confidence ? (
            <ConfidenceBadge confidence={p.confidence} />
          ) : null}
        </span>
      </div>
      {p.old ? <div className="text-13 text-ink-subtle line-through">{p.old}</div> : null}
      <div className="text-14 text-pretty">{p.text}</div>
      <div className="flex items-center gap-2 text-12 text-ink-subtle">
        {p.who ? (
          <>
            <span
              aria-hidden
              style={{ "--player": p.who.color } as CSSProperties}
              className="size-2 rounded-full bg-(--player)"
            />
            <span>{p.who.name}</span>
          </>
        ) : null}
        {p.t !== undefined && p.sessionId ? (
          <TimestampLink
            sessionId={p.sessionId}
            t={p.t}
            n={p.sessionN}
            hasAudio={p.hasAudio ?? false}
            onJump={p.onJump}
          />
        ) : p.t !== undefined ? (
          <span className="font-mono">{hms(p.t)}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">{p.actions}</span>
      </div>
    </div>
  )
}
