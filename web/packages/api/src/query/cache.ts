import type { QueryClient } from "@tanstack/react-query"
import type { CampaignAnswer } from "../ask/types.ts"
import type { Campaign, CampaignJob, CampaignSuggestions, Entity } from "../campaign/types.ts"
import { keys } from "./keys.ts"

/** Pure edits of the cached `Campaign`; every one is a no-op while nothing is cached. */
export type Edit = (c: Campaign) => Campaign

export const noEdit: Edit = (c) => c

export const jobActive = (j: Pick<CampaignJob, "state">) => j.state === "queued" || j.state === "running"
const answerEnded = (a: CampaignAnswer) => a.state === "done" || a.state === "error"

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export const withJob =
  (job: CampaignJob): Edit =>
  (c) => ({ ...c, jobs: upsertById(c.jobs, job) })

export const withAnswer =
  (answer: CampaignAnswer): Edit =>
  (c) => ({ ...c, answers: upsertById(c.answers, answer) })

/** Put a returned entry into the list, replacing `previousName` (a rename or a merge source). */
export const withEntity =
  (e: Entity, previousName: string = e.name): Edit =>
  (c) => ({
    ...c,
    entities: [...c.entities.filter((x) => x.name !== previousName && x.name !== e.name), e],
  })

export const withoutEntity =
  (name: string): Edit =>
  (c) => ({ ...c, entities: c.entities.filter((e) => e.name !== name) })

export const withIgnored =
  (ignored: string[]): Edit =>
  (c) => ({ ...c, ignored })

export const withFacts =
  (facts: string[]): Edit =>
  (c) => ({ ...c, facts })

export function editCampaign(client: QueryClient, edit: Edit) {
  client.setQueryData<Campaign>(keys.campaign(), (c) => c && edit(c))
}

export const putJob = (client: QueryClient, job: CampaignJob) => editCampaign(client, withJob(job))

/**
 * A fetched campaign merged over the cached one: a job or answer that already ended here stays as it
 * is, so a refetch that started earlier can't put a spinner back.
 */
export function mergeFetched(fetched: Campaign, cached: Campaign | undefined): Campaign {
  if (!cached) return fetched
  const jobs = new Map(cached.jobs.map((j) => [j.id, j]))
  const answers = new Map(cached.answers.map((a) => [a.id, a]))
  return {
    ...fetched,
    // Fetched jobs win (the old store did the same); jobs only seen via events are kept.
    jobs: [
      ...fetched.jobs.map((j) => {
        const mine = jobs.get(j.id)
        return mine && !jobActive(mine) && jobActive(j) ? mine : j
      }),
      ...cached.jobs.filter((j) => !fetched.jobs.some((f) => f.id === j.id)),
    ],
    answers: fetched.answers.map((a) => {
      const mine = answers.get(a.id)
      return mine && answerEnded(mine) && !answerEnded(a) ? mine : a
    }),
  }
}

/** Hide a suggestion row at once; returns what was removed so a failed write can put it back. */
export function hideSuggestion(
  client: QueryClient,
  row: { unknown: string } | { entity: string; heard: string },
): CampaignSuggestions | undefined {
  const before = client.getQueryData<CampaignSuggestions>(keys.suggestions())
  if (!before) return undefined
  client.setQueryData<CampaignSuggestions>(
    keys.suggestions(),
    "unknown" in row
      ? { ...before, unknown: before.unknown.filter((u) => u.heard !== row.unknown) }
      : {
          ...before,
          misheard: before.misheard.filter((m) => !(m.entity === row.entity && m.heard === row.heard)),
        },
  )
  return before
}

/** Undo `hideSuggestion` for its row only, so other changes made meanwhile survive. */
export function restoreSuggestion(
  client: QueryClient,
  before: CampaignSuggestions | undefined,
  row: { unknown: string } | { entity: string; heard: string },
) {
  if (!before) return
  client.setQueryData<CampaignSuggestions>(keys.suggestions(), (now) => {
    if (!now) return before
    if ("unknown" in row) {
      const back = before.unknown.find((u) => u.heard === row.unknown)
      return back && !now.unknown.some((u) => u.heard === row.unknown)
        ? { ...now, unknown: [...now.unknown, back] }
        : now
    }
    const back = before.misheard.find((m) => m.entity === row.entity && m.heard === row.heard)
    return back && !now.misheard.some((m) => m.entity === row.entity && m.heard === row.heard)
      ? { ...now, misheard: [...now.misheard, back] }
      : now
  })
}
