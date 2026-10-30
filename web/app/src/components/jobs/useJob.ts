import { useCampaign } from "@troubadour/api/campaign"
import type { CampaignJob } from "@troubadour/api/campaign"
import { jobActive } from "./progress.ts"

/** The latest job of a kind (and title, when given) from the campaign cache. Job ids are random, so the list order decides. */
export function useJob(kind: CampaignJob["kind"], title?: string) {
  const jobs = useCampaign().data?.jobs ?? []
  const job = jobs.filter((j) => j.kind === kind && (title === undefined || j.title === title)).at(-1)
  return { job, active: !!job && jobActive(job), failed: job?.state === "error" }
}
