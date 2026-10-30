import type { CampaignJob, Entity, EntityType, ObsidianVault } from "@troubadour/api/campaign"

/** Singular label, for badges and the type select. */
export const TYPE_LABEL: Record<EntityType, string> = {
  pc: "PC",
  npc: "NPC",
  place: "Place",
  faction: "Faction",
  item: "Item",
  creature: "Creature",
  spell: "Spell",
  term: "Term",
}

/** Plural label, for the filter chips. */
export const TYPE_PLURAL: Record<EntityType, string> = {
  pc: "PCs",
  npc: "NPCs",
  place: "Places",
  faction: "Factions",
  item: "Items",
  creature: "Creatures",
  spell: "Spells",
  term: "Terms",
}

export const ENTITY_TYPES = Object.keys(TYPE_LABEL) as EntityType[]

/** Something the LLM suggested is waiting for a human: the entry itself, a spelling, or a fact. */
export function needsReview(e: Entity): boolean {
  return e.status === "suggested" || e.heard_as_suggested.length > 0 || e.suggested_facts.length > 0
}

/** Case-insensitive match on name, aliases and heard-as spellings. */
export function matchesSearch(e: Entity, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [e.name, ...e.aliases, ...e.heard_as].some((s) => s.toLowerCase().includes(q))
}

/** Find an entry by name or alias (case-insensitive), e.g. the target of an Obsidian link. */
export function findEntity(entities: Entity[], name: string): Entity | undefined {
  const n = name.trim().toLowerCase()
  return (
    entities.find((e) => e.name.toLowerCase() === n) ??
    entities.find((e) => e.aliases.some((a) => a.toLowerCase() === n))
  )
}

/**
 * `obsidian://` link to the campaign folder, or to a note in it (`relPath`, relative to the folder).
 * Names the vault by registry id: `open?path=` failed for a vault nested inside another one.
 */
export function obsidianUrl(vault: ObsidianVault, relPath?: string | null): string {
  const url = `obsidian://open?vault=${encodeURIComponent(vault.id)}`
  const file = [vault.folder, relPath].filter(Boolean).join("/")
  return relPath ? `${url}&file=${encodeURIComponent(file)}` : url
}

export type FactSegment = { text: string } | { text: string; target: string }

/**
 * Split text on Obsidian links. `[[Target]]` shows "Target"; `[[Target|label]]` shows "label";
 * a `#heading` suffix on the target is dropped for lookup.
 */
export function splitWikiLinks(text: string): FactSegment[] {
  const out: FactSegment[] = []
  const re = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index
    const link = m[1] ?? ""
    if (i > last) out.push({ text: text.slice(last, i) })
    out.push({ text: (m[2] ?? link).trim(), target: link.split("#")[0]?.trim() ?? "" })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** The latest job that matches (job ids are random, so insertion order decides). */
export function latestJob(
  jobs: Record<string, CampaignJob>,
  match: (j: CampaignJob) => boolean,
): CampaignJob | undefined {
  return Object.values(jobs).filter(match).at(-1)
}

export function jobActive(j: CampaignJob): boolean {
  return j.state === "queued" || j.state === "running"
}

/** "3/10" once the total is known. */
export function jobCount(j: CampaignJob): string {
  return j.total > 0 ? `${j.done}/${j.total}` : ""
}

/** Items are the one type shown in the legendary tone; the rest are neutral. */
export function entityTone(type: EntityType): "legendary" | "neutral" {
  return type === "item" ? "legendary" : "neutral"
}

const REASON_MAX = 60

function reasonFrom(text: string): string {
  const plain = splitWikiLinks(text)
    .map((s) => s.text)
    .join("")
  return plain.length > REASON_MAX ? `${plain.slice(0, REASON_MAX - 1).trimEnd()}…` : plain
}

/**
 * Entries linked to `entity`: those its description or facts link to, then those whose facts link to it.
 * `reason` is the linking text (a fact or the description) with links shown as plain text, cut to 60
 * characters. One row per entry; the entry itself is never listed.
 */
export function connectedEntries(
  entity: Entity,
  campaign: { entities: Entity[] },
): { name: string; reason: string }[] {
  const found = new Map<string, string>()
  const add = (other: Entity | undefined, text: string) => {
    if (other && other !== entity && other.name !== entity.name && !found.has(other.name))
      found.set(other.name, reasonFrom(text))
  }
  const targets = (text: string) =>
    splitWikiLinks(text).flatMap((seg) => ("target" in seg ? [seg.target] : []))

  for (const text of [entity.description, ...entity.facts.map((f) => f.text)])
    for (const target of targets(text)) add(findEntity(campaign.entities, target), text)
  for (const other of campaign.entities)
    for (const { text } of other.facts)
      for (const target of targets(text))
        if (findEntity(campaign.entities, target) === entity) add(other, text)
  return [...found].map(([name, reason]) => ({ name, reason }))
}
