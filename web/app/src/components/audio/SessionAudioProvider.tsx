import type { ReactNode } from "react"

/** Passthrough until the session audio player (S3) fills it in. */
export function SessionAudioProvider({ children }: { children: ReactNode }) {
  return children
}
