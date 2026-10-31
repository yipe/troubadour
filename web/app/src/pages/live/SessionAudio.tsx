import { useEffect, useRef, useState } from "react"
import { Volume2, VolumeX } from "lucide-react"
import { fileUrl } from "@troubadour/api/audio"
import { sessionTimeNow, useLive } from "@troubadour/api/live"
import { Button } from "@troubadour/ui/button"

/** Plays the replayed sample file in step with the session clock (file sources only). */
export function SessionAudio() {
  const session = useLive((s) => s.session)
  const ref = useRef<HTMLAudioElement>(null)
  const [muted, setMuted] = useState(false)
  const [blocked, setBlocked] = useState(false)

  const file = session?.source?.kind === "file" ? session.source : null
  const url = file ? fileUrl(file.name) : undefined
  const running = session?.status === "running"

  // Re-sync on every session update; small drift is tolerated to avoid audible jumps.
  useEffect(() => {
    const audio = ref.current
    if (!audio || !file) return
    if (!running) {
      audio.pause()
      return
    }
    audio.playbackRate = file.speed
    const t = sessionTimeNow()
    if (Math.abs(audio.currentTime - t) > 1) audio.currentTime = t
    if (audio.paused)
      void audio.play()?.then(
        () => setBlocked(false),
        () => setBlocked(true),
      )
  }, [session, file, running, url])

  if (!file || !url) return null

  const resume = () => {
    const audio = ref.current
    if (!audio) return
    audio.currentTime = sessionTimeNow()
    void audio.play()?.then(
      () => setBlocked(false),
      () => setBlocked(true),
    )
  }

  return (
    <div className="flex items-center">
      <audio ref={ref} src={url} muted={muted} preload="auto" />
      {blocked && running ? (
        <Button size="sm" onClick={resume}>
          <Volume2 className="size-4" /> Play audio
        </Button>
      ) : (
        <button
          type="button"
          aria-label={muted ? "Unmute replay audio" : "Mute replay audio"}
          className="flex size-7 cursor-pointer items-center justify-center rounded-control text-ink-muted hover:bg-elevated hover:text-ink"
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}
    </div>
  )
}
