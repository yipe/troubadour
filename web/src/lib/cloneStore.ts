import { create } from "zustand"
import { api } from "./api"
import { jobActive } from "./campaign"
import { useCampaign } from "./campaignStore"
import type { CampaignJob, Clones } from "./types"

/** Voice clones (GET /api/clones): fetched by the views that show them, again whenever a clone job ends. */
export const useClones = create<{ clones: Clones | null }>(() => ({ clones: null }))

export const CLONE_JOBS: Partial<Record<CampaignJob["kind"], true>> = { clone: true, say: true, read: true }

export async function refreshClones() {
  try {
    useClones.setState({ clones: await api.clones() })
  } catch {
    // Keep what we have: the views still work, and the next finished job refetches.
  }
}

useCampaign.subscribe((s, prev) => {
  if (s.jobs === prev.jobs || !useClones.getState().clones) return
  const ended = Object.values(s.jobs).some((j) => {
    const before = prev.jobs[j.id]
    return !!CLONE_JOBS[j.kind] && !jobActive(j) && (!before || jobActive(before))
  })
  if (ended) void refreshClones()
})
