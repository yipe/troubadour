import { Play } from "lucide-react"
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
}

/** A moment in a session: plays the recording from there, or opens the transcript at that line. */
export function TimestampLink({ sessionId, t, label, n, hasAudio, onJump }: TimestampLinkProps) {
  const audio = useSessionAudio()
  const navigate = useNavigate()
  const text = label ?? hms(t)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono text-12 text-accent hover:underline"
      onClick={() => {
        onJump?.(t)
        if (hasAudio) audio.play(sessionId, t)
        else void navigate(paths.transcript(sessionId, t))
      }}
    >
      <Play aria-hidden className="size-3 fill-current" />
      {n === undefined ? text : `S${n} · ${text}`}
    </button>
  )
}
