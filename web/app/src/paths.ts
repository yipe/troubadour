/**
 * Every URL in the app. Links use `paths.*`, never a string literal, and `routes.tsx` builds its
 * route patterns from `patterns`, so changing a URL is one edit here.
 */

export const WELCOME_STEPS = ["campaign", "table", "microphone", "notes", "privacy"] as const
export type WelcomeStep = (typeof WELCOME_STEPS)[number]

export const SETTINGS_SECTIONS = ["models", "microphone", "players", "content", "vault", "cloud"] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** Route patterns (React Router syntax). */
export const patterns = {
  home: "/",
  welcome: "/welcome/:step",
  sessions: "/sessions",
  ready: "/sessions/new",
  live: "/sessions/live",
  session: "/sessions/:id",
  review: "/sessions/:id/review",
  transcript: "/sessions/:id/transcript",
  recap: "/sessions/:id/recap",
  timeline: "/timeline",
  codex: "/codex",
  codexEntry: "/codex/:entry",
  facts: "/facts",
  ask: "/ask",
  settings: "/settings/:section",
  gallery: "/dev/ui",
  // Old URLs, kept as redirects.
  oldSetup: "/setup",
  oldSession: "/session",
  oldHistory: "/history",
  oldHistoryEntry: "/history/:id",
  oldCampaign: "/campaign",
  oldCampaignEntry: "/campaign/:entry",
} as const

/** The facts page keeps its filters in the query string. */
export interface FactFilters {
  about?: string
  sure?: string
  by?: string
  q?: string
}

const seg = encodeURIComponent

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `${path}?${text}` : path
}

export const paths = {
  home: () => patterns.home,
  welcome: (step: WelcomeStep) => `/welcome/${step}`,
  sessions: () => patterns.sessions,
  /** The ready check; `source: "file"` opens the file-replay picker. */
  ready: (source?: "file") => withQuery(patterns.ready, { source }),
  live: () => patterns.live,
  session: (id: string) => `/sessions/${seg(id)}`,
  review: (id: string) => `/sessions/${seg(id)}/review`,
  /** `t`: session seconds to scroll to and highlight. */
  transcript: (id: string, t?: number) => withQuery(`/sessions/${seg(id)}/transcript`, { t }),
  recap: (id: string) => `/sessions/${seg(id)}/recap`,
  timeline: () => patterns.timeline,
  codex: (entry?: string) => (entry === undefined ? patterns.codex : `/codex/${seg(entry)}`),
  facts: (filters: FactFilters = {}) => withQuery(patterns.facts, { ...filters }),
  ask: () => patterns.ask,
  settings: (section: SettingsSection) => `/settings/${section}`,
  gallery: () => patterns.gallery,
}
