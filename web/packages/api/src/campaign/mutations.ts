import { useQueryClient } from "@tanstack/react-query"
import type { CampaignSuggestions } from "./types.ts"
import {
  hideSuggestion,
  noEdit,
  restoreSuggestion,
  withEntity,
  withFacts,
  withIgnored,
  withJob,
  withoutEntity,
} from "../query/cache.ts"
import { useCampaignWrite, type WriteContext } from "../query/campaignWrite.ts"
import { keys } from "../query/keys.ts"
import {
  addCampaignFact,
  addEntityFact,
  deleteCampaignFact,
  deleteEntity,
  deleteEntityFact,
  editCampaignFact,
  editEntityFact,
  ignoreWords,
  importNotes,
  mergeEntity,
  reviewEntity,
  seekFacts,
  unignoreWord,
  updateEntity,
  writeUp,
} from "./endpoints.ts"
import type { Entity, EntityFactCreate, EntityPatch, EntityReview, FactCreate, FactEdit } from "./types.ts"

/*
 * Every campaign write here goes through `useCampaignWrite`: one at a time, each computed from the
 * latest cache when it runs. `mutate` (or `mutateAsync`) resolves to undefined when there was
 * nothing to do (the entry is gone). Errors are on the mutation; the page shows them.
 */

/** The entry's name as it was before this write ran (`ctx.latest` is the cache from before it). */
const nameBefore = (ctx: WriteContext, name: string) => ctx.entity(name)?.name ?? name

/** Shared by every write that returns the updated entry. */
const entityApply = (e: Entity | undefined, name: string, ctx: WriteContext) =>
  e ? withEntity(e, nameBefore(ctx, name)) : noEdit

/** Run a change that yields the entry's new state; remembers renames for later queued writes. */
async function changeEntity(
  ctx: WriteContext,
  name: string,
  call: (latest: Entity) => Promise<Entity> | undefined,
): Promise<Entity | undefined> {
  const latest = ctx.entity(name)
  const pending = latest && call(latest)
  if (!latest || !pending) return undefined
  const e = await pending
  if (e.name !== latest.name) ctx.renamed(latest.name, e.name)
  return e
}

/** Edit one entry. `change` sees the entry as it is when the write runs and returns the fields to replace (or nothing to skip). */
export function useMutateEntity() {
  return useCampaignWrite(
    (vars: { name: string; change: (latest: Entity) => EntityPatch | undefined }, ctx) =>
      changeEntity(ctx, vars.name, (latest) => {
        const patch = vars.change(latest)
        return patch && updateEntity(latest.name, patch)
      }),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

export function useDeleteEntity() {
  return useCampaignWrite(
    async (name: string, ctx) => {
      const latest = ctx.entity(name)
      if (!latest) return undefined
      await deleteEntity(latest.name)
      return latest.name
    },
    { apply: (deleted) => (deleted ? withoutEntity(deleted) : noEdit) },
  )
}

/** Fold `name` into `into`; resolves to the merged entry. */
export function useMergeEntity() {
  return useCampaignWrite(
    async (vars: { name: string; into: string }, ctx) => {
      const source = ctx.entity(vars.name)
      const target = ctx.entity(vars.into)
      if (!source || !target) return undefined
      const merged = await mergeEntity(source.name, target.name)
      ctx.renamed(source.name, merged.name)
      return merged
    },
    {
      apply: (merged, vars, ctx) => {
        const source = nameBefore(ctx, vars.name)
        const target = nameBefore(ctx, vars.into)
        return merged ? (c) => withEntity(merged, target)(withoutEntity(source)(c)) : noEdit
      },
    },
  )
}

/** Accept or reject suggestions atomically on the server. */
export function useReviewEntity() {
  return useCampaignWrite(
    (vars: { name: string; review: EntityReview }, ctx) =>
      changeEntity(ctx, vars.name, (latest) => reviewEntity(latest.name, vars.review)),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

export function useAddEntityFact() {
  return useCampaignWrite(
    (vars: { name: string; fact: EntityFactCreate }, ctx) =>
      changeEntity(ctx, vars.name, (latest) => addEntityFact(latest.name, vars.fact)),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

const hasFact = (e: Entity, id: string) => [...e.facts, ...e.suggested_facts].some((f) => f.id === id)

/** Edit one fact by id (skipped when the fact is gone from the latest entry). */
export function useEditFact() {
  return useCampaignWrite(
    (vars: { name: string; edit: FactEdit }, ctx) =>
      changeEntity(ctx, vars.name, (latest) =>
        hasFact(latest, vars.edit.fact_id) ? editEntityFact(latest.name, vars.edit) : undefined,
      ),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

export function useDeleteFact() {
  return useCampaignWrite(
    (vars: { name: string; factId: string }, ctx) =>
      changeEntity(ctx, vars.name, (latest) =>
        hasFact(latest, vars.factId) ? deleteEntityFact(latest.name, vars.factId) : undefined,
      ),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

/** Accept or reject one suggested fact. An accepted update replaces the fact it names and keeps it as history. */
export function useReviewFact() {
  return useCampaignWrite(
    (vars: { name: string; factId: string; accept: boolean }, ctx) =>
      changeEntity(ctx, vars.name, (latest) =>
        latest.suggested_facts.some((f) => f.id === vars.factId)
          ? reviewEntity(
              latest.name,
              vars.accept ? { accept_facts: [vars.factId] } : { reject_facts: [vars.factId] },
            )
          : undefined,
      ),
    { apply: (e, vars, ctx) => entityApply(e, vars.name, ctx) },
  )
}

export function useAddCampaignFact() {
  return useCampaignWrite((fact: FactCreate) => addCampaignFact(fact), { apply: (facts) => withFacts(facts) })
}

export function useEditCampaignFact() {
  return useCampaignWrite((edit: FactEdit) => editCampaignFact(edit), { apply: (facts) => withFacts(facts) })
}

export function useDeleteCampaignFact() {
  return useCampaignWrite((factId: string) => deleteCampaignFact(factId), {
    apply: (facts) => withFacts(facts),
  })
}

/* ---- Spelling suggestions: the row hides at once and comes back if the write fails ---- */

export function useIgnoreWord() {
  const client = useQueryClient()
  return useCampaignWrite((word: string) => ignoreWords([word]), {
    onMutate: async (word): Promise<CampaignSuggestions | undefined> => {
      await client.cancelQueries({ queryKey: keys.suggestions() })
      return hideSuggestion(client, { unknown: word })
    },
    onError: (_e, word, before) => restoreSuggestion(client, before, { unknown: word }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.suggestions() }),
    apply: (ignored) => withIgnored(ignored),
  })
}

/** Undo `useIgnoreWord` (also the "Stop ignoring" button). */
export function useUnignoreWord() {
  const client = useQueryClient()
  return useCampaignWrite((word: string) => unignoreWord(word), {
    onSuccess: () => client.invalidateQueries({ queryKey: keys.suggestions() }),
    apply: (ignored) => withIgnored(ignored),
  })
}

/**
 * "Not a misspelling of" an entry. `suggested` is the entry name as the suggestion row gave it;
 * `entity` the glossary entry it resolved to.
 */
export function useRejectMisheard() {
  const client = useQueryClient()
  return useCampaignWrite(
    (vars: { suggested: string; entity: string; heard: string }, ctx) =>
      changeEntity(ctx, vars.entity, (latest) =>
        reviewEntity(latest.name, { reject_spellings: [vars.heard] }),
      ).then((e) => {
        // Nothing to reject on: fail so the row comes back.
        if (!e) throw new Error(`"${vars.entity}" is no longer in the glossary`)
        return e
      }),
    {
      onMutate: async (vars): Promise<CampaignSuggestions | undefined> => {
        await client.cancelQueries({ queryKey: keys.suggestions() })
        return hideSuggestion(client, { entity: vars.suggested, heard: vars.heard })
      },
      onError: (_e, vars, before) =>
        restoreSuggestion(client, before, { entity: vars.suggested, heard: vars.heard }),
      onSuccess: () => client.invalidateQueries({ queryKey: keys.suggestions() }),
      apply: (e, vars, ctx) => entityApply(e, vars.entity, ctx),
    },
  )
}

/** Undo `useRejectMisheard`: drop the spelling from the entry's rejected list (from the latest list). */
export function useUnrejectMisheard() {
  const client = useQueryClient()
  return useCampaignWrite(
    (vars: { entity: string; heard: string }, ctx) =>
      changeEntity(ctx, vars.entity, (latest) =>
        latest.heard_as_rejected.includes(vars.heard)
          ? updateEntity(latest.name, {
              heard_as_rejected: latest.heard_as_rejected.filter((x) => x !== vars.heard),
            })
          : undefined,
      ),
    {
      onSuccess: () => client.invalidateQueries({ queryKey: keys.suggestions() }),
      apply: (e, vars, ctx) => entityApply(e, vars.entity, ctx),
    },
  )
}

/* ---- Background jobs: the response is the queued job, put into the campaign's job list ---- */

export function useImportNotes() {
  return useCampaignWrite((vars: { title: string; text: string }) => importNotes(vars.title, vars.text), {
    apply: (job) => withJob(job),
  })
}

export function useWriteUp() {
  return useCampaignWrite((sessionId: string) => writeUp(sessionId), { apply: (job) => withJob(job) })
}

/** Look for more facts about one entry (job "facts"). */
export function useSeekFacts() {
  return useCampaignWrite((name: string, ctx) => seekFacts(ctx.entity(name)?.name ?? name), {
    apply: (job) => withJob(job),
  })
}
