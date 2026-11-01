import { Sparkles } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useNameSession, type SavedSession } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { jobActive } from "../../components/jobs/progress.ts"

/** A title that says nothing: none, "Session 3", "Notes". The server's `GENERIC_TITLE` matches the same. */
export const genericTitle = (title: string | null): boolean =>
  !title?.trim() || /^(?:session\s*\d*|notes|untitled|part\s*\d+)$/i.test(title.trim())

/** For a notes session with a generic title: the model names it from its notes. */
export function GenerateName({ session, disabled }: { session: SavedSession; disabled: boolean }) {
  const name = useNameSession()
  const jobs = useCampaign().data?.jobs ?? []
  const naming = jobs.some((j) => j.kind === "name" && j.title === session.id && jobActive(j))
  const failed = jobs.findLast((j) => j.kind === "name" && j.title === session.id)
  if (!genericTitle(session.title) && !naming) return null
  return (
    <span className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || naming || name.isPending}
        onClick={() => name.mutate(session.id)}
      >
        <Sparkles className="size-3.5" /> {naming ? "Naming…" : "Generate a name"}
      </Button>
      {(name.error ?? (failed?.state === "error" ? failed : null)) && (
        <span role="alert" className="text-12 text-danger">
          {name.error?.message ?? failed?.message}
        </span>
      )}
    </span>
  )
}
