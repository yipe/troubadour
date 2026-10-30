/**
 * Every query key in one place. The first element is the domain; `liveOnlyRoots` lists the ones that
 * don't belong to a campaign.
 */
export const keys = {
  campaign: () => ["campaign"] as const,
  /** A glossary entry. There is no per-entry GET: `useEntity` selects from `keys.campaign()`. */
  entity: (name: string) => ["entity", name] as const,
  suggestions: () => ["suggestions"] as const,
  campaigns: () => ["campaigns"] as const,
  sessions: () => ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  record: (id: string) => ["record", id] as const,
  quality: (id: string) => ["quality", id] as const,
  cloud: () => ["cloud"] as const,
  cloudAccount: () => ["cloudAccount"] as const,
  cloudVaults: () => ["cloudVaults"] as const,
  /** Hosted providers and which one is picked (kept current by `llm.updated`). */
  llm: () => ["llm"] as const,
  models: () => ["models"] as const,
  llmModels: (provider: string) => ["llmModels", provider] as const,
  localServers: () => ["localServers"] as const,
  mics: () => ["mics"] as const,
  sources: () => ["sources"] as const,
  clones: () => ["clones"] as const,
  classes: () => ["classes"] as const, // C1
  // C-domains: the C tasks write the hooks, the keys are here so they don't touch this file.
  notebook: () => ["notebook"] as const,
  review: (id: string) => ["review", id] as const,
  timeline: () => ["timeline"] as const,
  recap: (id: string) => ["recap", id] as const,
  storage: () => ["storage"] as const,
}

/** Describe this Mac or the live session, not the open campaign: a campaign switch leaves them alone. */
const liveOnlyRoots: ReadonlySet<unknown> = new Set([
  "mics",
  "sources",
  "models",
  "llm",
  "llmModels",
  "localServers",
  "cloudAccount",
])

export const isLiveOnlyKey = (key: readonly unknown[]): boolean => liveOnlyRoots.has(key[0])
