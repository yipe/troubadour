import { useEffect, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"

/** `url` is opaque (it carries a cache-busting query); a new url remounts so playback state resets. */
export function SamplePlayButton({ url }: { url: string }) {
  return <SampleButton key={url} url={url} />
}

function SampleButton({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const audio = ref.current
    return () => audio?.pause()
  }, [])
  return (
    <>
      <audio
        ref={ref}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        aria-label={playing ? "Pause sample" : "Play sample"}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-elevated hover:text-ink"
        onClick={() => {
          const audio = ref.current
          if (!audio) return
          if (audio.paused) {
            audio.currentTime = 0
            void audio.play()?.catch(() => setPlaying(false))
          } else audio.pause()
        }}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    </>
  )
}
