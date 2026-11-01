import type { CampaignJob } from "@troubadour/api/campaign"
import type { SavedSession } from "@troubadour/api/sessions"
import { jobActive } from "../../components/jobs/progress.ts"

export type NotesStatus =
  { state: "queued" } | { state: "reading"; job: CampaignJob } | { state: "unread" } | { state: "read" }

/**
 * Where a notes session is in being read into the codex. An import reads its sessions one after
 * another, and the first still listed on the job is the one in progress. "unread": no job has it
 * (it failed, or the server restarted first).
 */
export function notesStatus(
  session: Pick<SavedSession, "id" | "ingested">,
  jobs: CampaignJob[],
): NotesStatus {
  const job = jobs.find((j) => j.kind === "import" && jobActive(j) && j.sessions?.includes(session.id))
  if (job)
    return job.state === "running" && job.sessions?.[0] === session.id
      ? { state: "reading", job }
      : { state: "queued" }
  return { state: session.ingested ? "read" : "unread" }
}
