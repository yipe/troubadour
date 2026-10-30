import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { sessionAudioUrl } from "@troubadour/api/sessions"

export interface SessionAudio {
  /** What is playing now (`t`: where it started, in session seconds); null when stopped. */
  playing: { sessionId: string; t: number } | null
  /** Start a saved session's recording at `t` seconds. Call it from a click handler only. */
  play: (sessionId: string, t: number) => void
  stop: () => void
}

const SessionAudioContext = createContext<SessionAudio | null>(null)

/** One shared `<audio>` element, so two timestamps never play over each other. */
export function SessionAudioProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState<SessionAudio["playing"]>(null)
  const current = useRef<{ sessionId: string; t: number } | null>(null)

  const play = useCallback((sessionId: string, t: number) => {
    const audio = ref.current
    if (!audio) return
    const url = sessionAudioUrl(sessionId)
    const start = () => {
      audio.currentTime = t
      // A blocked or failed start leaves nothing playing; the pause/error handlers clear the state.
      audio.play()?.catch(() => setPlaying(null))
    }
    current.current = { sessionId, t }
    setPlaying(current.current)
    if (audio.getAttribute("src") === url) return start()
    // preload="none": the new file has no duration until its metadata loads, and seeking earlier is lost.
    audio.addEventListener("loadedmetadata", start, { once: true })
    audio.src = url
    audio.load()
  }, [])

  const stop = useCallback(() => {
    ref.current?.pause()
    current.current = null
    setPlaying(null)
  }, [])

  useEffect(() => {
    const audio = ref.current
    return () => audio?.pause()
  }, [])

  const value = useMemo(() => ({ playing, play, stop }), [playing, play, stop])
  return (
    <SessionAudioContext value={value}>
      {children}
      <audio
        ref={ref}
        preload="none"
        onEnded={() => setPlaying(null)}
        onPause={() => setPlaying(null)}
        onError={() => setPlaying(null)}
      />
    </SessionAudioContext>
  )
}

export function useSessionAudio(): SessionAudio {
  const value = useContext(SessionAudioContext)
  if (!value) throw new Error("useSessionAudio needs a SessionAudioProvider")
  return value
}
