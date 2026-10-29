import { useEffect } from "react"
import { BookOpenText, Loader2 } from "lucide-react"
import { ReadAloud } from "@/components/clone/ReadAloud"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { jobActive, jobCount, latestJob } from "@/lib/campaign"
import { campaignActions, useCampaign } from "@/lib/campaignStore"
import { JobStatus } from "./JobProgress"
import { ObsidianLink } from "./ObsidianLink"

/** History viewer: summarize this saved session into a campaign session page plus suggestions. */
export function WriteUpButton({ sessionId }: { sessionId: string }) {
  const campaign = useCampaign((s) => s.campaign)
  const job = useCampaign((s) => latestJob(s.jobs, (j) => j.kind === "writeup" && j.title === sessionId))

  useEffect(() => {
    if (!useCampaign.getState().campaign) void campaignActions.refresh()
  }, [])

  const running = !!job && jobActive(job)
  const page = campaign?.written_up[sessionId]

  return (
    <span className="flex flex-col items-start gap-3 text-sm">
      <Button
        size="sm"
        variant="outline"
        disabled={running}
        onClick={() => void campaignActions.startJob(() => api.writeUp(sessionId))}
      >
        {running ? <Loader2 className="animate-spin" /> : <BookOpenText />}
        {page ? "Write up again" : "Write up for campaign"}
        {running && <span className="text-muted-foreground tabular-nums">{jobCount(job)}</span>}
      </Button>
      <JobStatus job={job} working="Writing up…" failed="Write-up failed" progress={false} />
      {page && <ObsidianLink relPath={page}>Session page</ObsidianLink>}
      {page && <ReadAloud sessionId={sessionId} page={page} />}
    </span>
  )
}
