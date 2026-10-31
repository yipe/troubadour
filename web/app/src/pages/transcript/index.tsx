import { useMemo, useRef, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router"
import { FileX, Pause, Play } from "lucide-react"
import { useClasses } from "@troubadour/api/players"
import { useSessionRecord, useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { EmptyState } from "@troubadour/ui/empty-state"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { SearchInput } from "@troubadour/ui/search-input"
import { SectionLabel } from "@troubadour/ui/section-label"
import { SegmentedBar } from "@troubadour/ui/segmented-bar"
import { Spinner } from "@troubadour/ui/spinner"
import { useSessionAudio } from "../../components/audio/SessionAudioProvider.tsx"
import { PlayerAvatar } from "../../components/people/PlayerAvatar.tsx"
import { TranscriptList } from "../../components/transcript/TranscriptList.tsx"
import { recordToViewLines } from "../../components/transcript/viewLines.ts"
import { dateLong, hms } from "../../lib/format.ts"
import { recordTalkTime, sharePct, talkSegments } from "../../lib/talk.ts"
import { paths } from "../../paths.ts"
import { filterLines, lineAt, parseSeconds } from "./lines.ts"
import { HIGHLIGHT_NAME, useSearchHighlight } from "./useSearchHighlight.ts"

export function Component() {
  const { id = "" } = useParams()
  const record = useSessionRecord(id)
  const sessions = useSessions()
  const classData = useClasses().data
  const classes = useMemo(() => classData ?? [], [classData])
  const [params] = useSearchParams()
  const audio = useSessionAudio()
  const [query, setQuery] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  useSearchHighlight(listRef, query)

  const data = record.data
  const summary = sessions.data?.find((s) => s.id === id)
  const lines = useMemo(() => (data ? recordToViewLines(data, classes) : []), [data, classes])
  const shown = useMemo(() => filterLines(lines, query), [lines, query])
  const talk = useMemo(
    () =>
      recordTalkTime(
        (data?.messages ?? []).map((m) => ({
          t_start: m.t_start,
          t_end: m.t_end,
          player_id: m.player_id,
        })),
      ),
    [data],
  )

  if (record.isError) {
    return (
      <EmptyState
        icon={<FileX className="size-8" />}
        title="Couldn't load this transcript"
        body={record.error.message}
        action={
          <Button nativeButton={false} render={<Link to={paths.sessions()} role="link" />}>
            Back to sessions
          </Button>
        }
      />
    )
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-14 text-ink-muted">
        <Spinner /> Loading transcript…
      </div>
    )
  }

  const t = parseSeconds(params.get("t"))
  const target = t === null ? null : (lineAt(lines, t)?.id ?? null)
  const hasAudio = summary?.audio ?? false
  const playing = audio.playing?.sessionId === id
  const title = summary?.title || (summary?.n ? `Session ${summary.n}` : "Transcript")
  const started = summary?.started_at ?? data.session.started_at
  const players = data.players
  const speakers = players.filter((p) => (talk.byPlayer.get(p.id) ?? 0) > 0)

  return (
    <RailLayout
      railWidth={300}
      rail={
        <div className="flex flex-col gap-5 p-5">
          <div>
            <SectionLabel>Transcript</SectionLabel>
            <h1 className="mt-1 font-serif text-22 leading-tight font-bold text-ink">{title}</h1>
            <p className="mt-1 text-13 text-ink-muted">
              {typeof started === "number" ? dateLong(started) : ""}
              {data.session.duration_s ? ` · ${hms(data.session.duration_s)}` : ""}
            </p>
          </div>

          {hasAudio ? (
            <Button
              variant="secondary"
              onClick={() => (playing ? audio.stop() : audio.play(id, 0))}
              aria-label={playing ? "Pause session audio" : "Play session audio"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause" : "Play session audio"}
            </Button>
          ) : null}

          <div className="flex flex-col gap-2">
            <SectionLabel>Speakers</SectionLabel>
            {talk.total > 0 ? (
              <SegmentedBar
                segments={talkSegments(Object.fromEntries(talk.byPlayer), players, classes)}
                height={8}
              />
            ) : null}
            <ul className="flex flex-col gap-2">
              {speakers.map((p) => (
                <li key={p.id} className="flex items-center gap-2.5 text-14">
                  <PlayerAvatar player={p} size={24} />
                  <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                  <span className="text-13 text-ink-muted tabular-nums">
                    {sharePct(talk.byPlayer.get(p.id) ?? 0, talk.total)}
                  </span>
                </li>
              ))}
              {speakers.length === 0 ? <li className="text-13 text-ink-subtle">No named speakers.</li> : null}
            </ul>
          </div>

          <nav className="flex flex-col gap-1.5 text-14">
            <Link className="text-accent hover:underline" to={paths.session(id)}>
              Session page
            </Link>
            <Link className="text-accent hover:underline" to={paths.review(id)}>
              Review the write-up
            </Link>
          </nav>
        </div>
      }
    >
      <div className="flex h-[75dvh] min-h-0 flex-col lg:h-full">
        <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: var(--color-warning); color: var(--color-bg-canvas); }`}</style>
        <div className="border-b border-line px-5 py-3">
          <SearchInput
            aria-label="Search transcript"
            placeholder="Search this transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
          />
        </div>
        {lines.length === 0 ? (
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
              onTimestamp={hasAudio ? (line) => audio.play(id, line.t) : undefined}
            />
          </div>
        )}
      </div>
    </RailLayout>
  )
}
