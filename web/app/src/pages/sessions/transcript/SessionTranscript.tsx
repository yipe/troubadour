import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router"
import { FileX, Pause, Play, Wand2 } from "lucide-react"
import { useClasses } from "@troubadour/api/players"
import { useSessionRecord, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { EmptyState } from "@troubadour/ui/empty-state"
import { SearchInput } from "@troubadour/ui/search-input"
import { SectionHeading } from "@troubadour/ui/section-heading"
import { Spinner } from "@troubadour/ui/spinner"
import { useSessionAudio } from "../../../components/audio/SessionAudioProvider.tsx"
import { TranscriptList } from "../../../components/transcript/TranscriptList.tsx"
import { recordToViewLines } from "../../../components/transcript/viewLines.ts"
import { filterLines, lineAt, parseSeconds } from "./lines.ts"
import { HIGHLIGHT_NAME, useSearchHighlight } from "./useSearchHighlight.ts"

export const TRANSCRIPT_ANCHOR = "transcript"

/**
 * The session's transcript, under its details. A link to `#transcript` or `?t=<seconds>` scrolls here,
 * and `?t=` also highlights the line being spoken at that time.
 */
export function SessionTranscript({ session, onImprove }: { session: SavedSession; onImprove: () => void }) {
  const record = useSessionRecord(session.id)
  const classData = useClasses().data
  const classes = useMemo(() => classData ?? [], [classData])
  const [params] = useSearchParams()
  const location = useLocation()
  const audio = useSessionAudio()
  const [query, setQuery] = useState("")
  const section = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useSearchHighlight(listRef, query)

  const data = record.data
  const lines = useMemo(() => (data ? recordToViewLines(data, classes) : []), [data, classes])
  const shown = useMemo(() => filterLines(lines, query), [lines, query])
  const t = parseSeconds(params.get("t"))
  const target = t === null ? null : (lineAt(lines, t)?.id ?? null)
  const wanted = location.hash === `#${TRANSCRIPT_ANCHOR}` || t !== null

  // `location.key` changes on every navigation, so a second click on the same link scrolls again.
  useEffect(() => {
    if (wanted) section.current?.scrollIntoView({ block: "start" })
  }, [wanted, location.key])

  const playing = audio.playing?.sessionId === session.id

  return (
    <section
      ref={section}
      id={TRANSCRIPT_ANCHOR}
      aria-label="Transcript"
      className="flex flex-col gap-3 pb-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <SectionHeading>Transcript</SectionHeading>
        {session.audio ? (
          <Button
            variant="secondary"
            onClick={() => (playing ? audio.stop() : audio.play(session.id, 0))}
            aria-label={playing ? "Pause session audio" : "Play session audio"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play session audio"}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onImprove}>
          <Wand2 className="size-4" />
          Improve transcript
        </Button>
        <div className="ml-auto w-full max-w-xs">
          <SearchInput
            aria-label="Search transcript"
            placeholder="Search this transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
          />
        </div>
      </div>
      <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: var(--color-warning); color: var(--color-bg-canvas); }`}</style>
      <div className="flex h-[70dvh] min-h-[24rem] flex-col overflow-hidden rounded-card border border-line">
        {record.isError ? (
          <EmptyState
            icon={<FileX className="size-8" />}
            title="Couldn't load this transcript"
            body={record.error.message}
          />
        ) : !data ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-14 text-ink-muted">
            <Spinner /> Loading transcript…
          </div>
        ) : lines.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-14 text-ink-muted">
            This session has no lines.
          </p>
        ) : shown.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-14 text-ink-muted">
            No lines match “{query.trim()}”.
          </p>
        ) : (
          <div ref={listRef} className="flex min-h-0 flex-1 flex-col">
            <TranscriptList
              lines={shown}
              mode="static"
              highlightId={target}
              scrollToId={target}
              onTimestamp={session.audio ? (line) => audio.play(session.id, line.t) : undefined}
              onStop={audio.stop}
              playingT={playing ? audio.playing!.t : null}
            />
          </div>
        )}
      </div>
    </section>
  )
}
