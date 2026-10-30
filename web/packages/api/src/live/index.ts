import type { Socket } from "../socket/index.ts"
import { applyAudioEvent, resetAudio } from "./audio.ts"
import { applySpeaker, resetSpeaking } from "./speaking.ts"
import { applyEvent, liveActions, resetStore, setOnError } from "./store.ts"

export * from "./store.ts"
export * from "./speaking.ts"
export * from "./audio.ts"
export * from "./hooks.ts"

/** Feed the live store, speaking and audio from the socket. Returns the unsubscribe. */
export function wireLive(socket: Socket, opts: { onError?: (message: string) => void } = {}): () => void {
  if (opts.onError) setOnError(opts.onError)
  liveActions.setConnected(socket.connected())
  const offStatus = socket.onStatus(liveActions.setConnected)
  const offEvents = socket.onAny((ev) => {
    switch (ev.type) {
      case "speaker.active":
        return applySpeaker(ev.data.voice_id)
      case "audio.level":
      case "audio.quality":
      case "mic.test":
        return applyAudioEvent(ev)
      default:
        return applyEvent(ev)
    }
  })
  return () => {
    offStatus()
    offEvents()
  }
}

/** Test seam: back to the initial state everywhere. */
export function resetLive() {
  resetStore()
  resetSpeaking()
  resetAudio()
}
