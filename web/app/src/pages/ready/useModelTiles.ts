import { useModelSettings } from "@troubadour/api/llm"
import { useLive } from "@troubadour/api/live"

export type Tone = "success" | "warning" | "danger"

export interface Tile {
  title: string
  detail: string
  status: string
  tone: Tone
}

/** What the three models are doing, from the live session's status (the server reports it while idle too). */
export function useModelTiles(): Tile[] {
  const session = useLive((s) => s.session)
  const trained = useLive((s) => s.players.filter((p) => p.trained).length)
  const settings = useModelSettings().data
  const asr = session?.asr
  const llm = session?.llm

  const speech: Tile = {
    title: "Speech to text",
    detail: asr?.model ?? settings?.whisper ?? "",
    ...(asr?.state === "ready"
      ? { status: "Ready", tone: "success" }
      : asr?.state === "error"
        ? { status: "Failed to load", tone: "danger" }
        : { status: "Loading", tone: "warning" }),
  }
  const voice: Tile = {
    title: "Voice",
    detail: "pyannote embeddings",
    status: `Ready · ${trained} known ${trained === 1 ? "voice" : "voices"}`,
    tone: "success",
  }
  const notes: Tile = {
    title: "Notes & answers",
    detail: llm?.model ?? settings?.llm ?? "",
    ...(llm === undefined
      ? { status: "Loading", tone: "warning" }
      : llm.ok
        ? { status: "Ready", tone: "success" }
        : { status: "Not running", tone: "danger" }),
  }
  return [speech, voice, notes]
}
