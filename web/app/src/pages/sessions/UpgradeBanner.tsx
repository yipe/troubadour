import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { History } from "lucide-react"
import { useCampaign } from "@troubadour/api/campaign"
import { useLive } from "@troubadour/api/live"
import { keys } from "@troubadour/api/query"
import { REFRESH_JOB, useUpgradeSessions, useUpgrades } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { IconTile } from "@troubadour/ui/icon-tile"
import { JobStatus } from "../../components/jobs/JobStatus.tsx"
import { jobActive } from "../../components/jobs/progress.ts"

/**
 * Shown on Home and in Sessions while saved sessions were processed by an older Troubadour. One click
 * queues the steps that changed, session by session, oldest first; nothing is shown once all are current.
 */
export function UpgradeBanner() {
  const client = useQueryClient()
  const upgrades = useUpgrades().data
  const upgrade = useUpgradeSessions()
  const running = useLive((s) => (s.session?.status ?? "idle") !== "idle")
  const jobs = (useCampaign().data?.jobs ?? []).filter((j) => j.kind === REFRESH_JOB)
  const active = jobs.filter(jobActive)

  // When the queue empties, what is stale has changed.
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && active.length === 0) void client.invalidateQueries({ queryKey: keys.sessions() })
    wasActive.current = active.length > 0
  }, [active.length, client])

  const stale = upgrades?.sessions.length ?? 0
  if (stale === 0 && active.length === 0) return null
  const busy = active.length > 0 || upgrade.isPending

  return (
    <div
      role="region"
      aria-label="Upgrade old sessions"
      className="flex items-center gap-4 rounded-card border border-line bg-surface px-5 py-4"
    >
      <IconTile tone="accent" size={36}>
        <History className="size-5" />
      </IconTile>
      <div className="min-w-0 flex-1">
        {active.length > 0 ? (
          <>
            <div className="font-semibold text-ink">
              Upgrading {active.length} {active.length === 1 ? "session" : "sessions"}
            </div>
            <JobStatus job={active[0]!} variant="inline" />
          </>
        ) : (
          <>
            <div className="font-semibold text-ink">
              {stale} {stale === 1 ? "session was" : "sessions were"} processed by an older Troubadour
            </div>
            <div className="text-13 text-ink-muted">
              Upgrading redoes only the steps that changed. Originals and confirmed facts are kept.
              {running && " Wait for the session to end."}
            </div>
          </>
        )}
        {upgrade.error && (
          <p role="alert" className="text-13 text-danger">
            {upgrade.error.message}
          </p>
        )}
      </div>
      <Button variant="primary" size="lg" disabled={busy || running} onClick={() => upgrade.mutate()}>
        Upgrade
      </Button>
    </div>
  )
}
