import { Play, Square } from "lucide-react"
import { useNavigate } from "react-router"
import { hms } from "../../lib/format.ts"
import { paths } from "../../paths.ts"
import { useSessionAudio } from "./SessionAudioProvider.tsx"

export type TimestampLinkProps = {
  sessionId: string
  /** Session seconds. */
  t: number
  /** Replaces the clock text. */
  label?: string
  /** The session's number: shown as "S12 · 1:41:55". */
  n?: number
  /** The saved session has its own recording to play. */
  hasAudio: boolean
  /** Called with `t` on click, before anything plays or navigates. */
  onJump?: (t: number) => void
  /** Show the play button only while the pointer or focus is on the timestamp (it stays while playing). */
  revealOnHover?: boolean
}

/** A moment in a session: plays the recording from there, or opens the transcript at that line. */
export function TimestampLink({
  sessionId,
  t,
  label,
  n,
  hasAudio,
  onJump,
  revealOnHover,
}: TimestampLinkProps) {
  const audio = useSessionAudio()
  const navigate = useNavigate()
  const text = label ?? hms(t)
  const playing = audio.playing?.sessionId === sessionId && audio.playing.t === t
  return (
    <button
      type="button"
      className="group inline-flex items-center gap-1 font-mono text-12 text-accent hover:underline"
      aria-label={playing ? `Stop ${n === undefined ? text : `S${n} · ${text}`}` : undefined}
      onClick={() => {
        if (playing) return audio.stop()
        onJump?.(t)
        if (hasAudio) audio.play(sessionId, t)
        else void navigate(paths.transcript(sessionId, t))
      }}
    >
      {playing ? (
        <Square aria-hidden className="size-3 fill-current" />
      ) : (
        <Play
          aria-hidden
          className={`size-3 fill-current ${revealOnHover ? "invisible group-hover:visible group-focus-visible:visible" : ""}`}
        />
      )}
      {n === undefined ? text : `S${n} · ${text}`}
    </button>
  )
}
