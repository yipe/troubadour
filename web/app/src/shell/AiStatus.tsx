import { Lock } from "lucide-react"
import { Link } from "react-router"
import { useLive } from "@troubadour/api/live"
import { useLlm } from "@troubadour/api/llm"
import { StatusDot } from "@troubadour/ui/status-dot"
import { paths } from "../paths.ts"

/** Where the language model runs, and whether the speech and language models are up. Opens Models. */
export function AiStatus() {
  const session = useLive((s) => s.session)
  const llm = useLlm().data
  const hosted = llm && llm.provider !== "local" ? llm.providers.find((p) => p.id === llm.provider) : null

  let tone: "success" | "warning" | "danger" = "warning"
  let text = "AI loading"
  if (session && session.asr.state === "ready" && session.llm.ok) {
    tone = "success"
    text = "AI ready"
  } else if (session && (session.asr.state === "error" || session.asr.state === "ready")) {
    tone = "danger"
    text = "AI off"
  }

  return (
    <Link
      to={paths.settings("models")}
      className="flex h-[30px] items-center gap-3 rounded-control border border-line px-2.5 text-12 text-ink-muted hover:text-ink"
    >
      {llm && (
        <span className="flex items-center gap-1.5">
          {!hosted && <Lock size={12} />}
          {hosted ? hosted.label : "On this computer"}
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <StatusDot tone={tone} />
        {text}
      </span>
    </Link>
  )
}
