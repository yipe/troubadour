import { Pause, Play } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@troubadour/ui/button"

/** Play/pause for one finished clip. Nothing loads or plays until the first click. */
export function ClipPlayer({ src, label }: { src: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  return (
    <>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <Button
        size="sm"
        variant="secondary"
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        onClick={() => {
          const el = audio.current
          if (!el) return
          if (playing) el.pause()
          else void el.play().catch(() => setPlaying(false))
        }}
      >
        {playing ? <Pause /> : <Play />}
        {playing ? "Pause" : "Play"}
      </Button>
    </>
  )
}
