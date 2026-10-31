import { create } from "zustand"

export const SPEAKING_CLEAR_MS = 1500

/** Its own store so ~4 Hz updates don't re-render the transcript. */
export const useSpeaking = create<{ voiceId: string | null }>(() => ({ voiceId: null }))

let timer: ReturnType<typeof setTimeout> | undefined

/** A voice that stops being reported is cleared after 1.5 s, so a dropped event can't stick. */
export function applySpeaker(voiceId: string | null) {
  clearTimeout(timer)
  useSpeaking.setState({ voiceId })
  if (voiceId) timer = setTimeout(() => useSpeaking.setState({ voiceId: null }), SPEAKING_CLEAR_MS)
}

export function resetSpeaking() {
  clearTimeout(timer)
  useSpeaking.setState({ voiceId: null })
}
