import { Link } from "react-router"
import { Check } from "lucide-react"
import { useModelSettings } from "@troubadour/api/llm"
import { cn } from "@troubadour/ui/cn"
import { StatusDot } from "@troubadour/ui/status-dot"
import { paths } from "../../paths.ts"
import type { Tile, Tone } from "./useModelTiles.ts"

const TEXT: Record<Tone, string> = { success: "text-success", warning: "text-warning", danger: "text-danger" }

export function ModelTiles({ tiles }: { tiles: Tile[] }) {
  const ready = tiles.every((t) => t.tone === "success")
  const provider = useModelSettings().data?.provider
  return (
    <section
      aria-label="Models"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface px-[18px] py-4"
    >
      <div className="flex items-center gap-2.5">
        <span
          data-testid="models-status"
          className={cn(
            "flex size-[22px] items-center justify-center rounded-full text-12 font-bold",
            ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
          )}
        >
          {ready ? <Check className="size-3" aria-hidden /> : "!"}
        </span>
        <h3 className="font-bold">Models</h3>
        <span className="ml-auto text-13 text-ink-subtle">
          {provider && provider !== "local" ? "Hosted notes model" : "All local"} ·{" "}
          <Link to={paths.settings("models")} className="text-accent hover:underline">
            Change
          </Link>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {tiles.map((t) => (
          <div key={t.title} className="bg-subtle min-w-0 rounded-control border border-line px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-13 font-semibold">
              <StatusDot tone={t.tone} />
              {t.title}
            </div>
            <div className="mt-0.5 truncate text-12 text-ink-subtle">{t.detail}</div>
            <div className={cn("mt-1 text-12", TEXT[t.tone])}>{t.status}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
