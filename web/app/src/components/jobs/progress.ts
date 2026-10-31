import type { CampaignJob, JobLive, JobSnippet } from "@troubadour/api/campaign"

/** The marquee shows a new find this often. */
export const MARQUEE_MS = 12000

export function jobActive(job: CampaignJob): boolean {
  return job.state === "queued" || job.state === "running"
}

/** "3/10" once the total is known. */
export function jobCount(job: CampaignJob): string {
  return job.total > 0 ? `${job.done}/${job.total}` : ""
}

/**
 * How far along, 0 to 1, or null when nothing can tell. The server computes the step fractions (the notes
 * step by the session time its beats reach, the page step by characters written against its usual length),
 * so the live call's fraction wins over the job's done/total.
 */
export function jobFraction(job: CampaignJob): number | null {
  if (job.live?.fraction !== undefined) return job.live.fraction
  return job.total > 0 ? job.done / job.total : null
}

/** 42 -> "42 s", 240 -> "4 m 00 s", 3725 -> "1 h 02 m 05 s". */
export function elapsed(seconds: number): string {
  const t = Math.max(0, Math.round(seconds))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (h) return `${h} h ${pad(m)} m ${pad(t % 60)} s`
  if (m) return `${m} m ${pad(t % 60)} s`
  return `${t} s`
}

/** What a streaming model call is doing: "Reading… 2 m 14 s", "Writing · 312 tokens · 18 tok/s". */
export function liveText(live: JobLive, nowSeconds: number): string {
  if (live.phase === "reading") return `Reading… ${elapsed(nowSeconds - live.started)}`
  const what = live.phase === "thinking" ? "Thinking" : "Writing"
  return `${what} · ${live.tokens.toLocaleString("en-US")} tokens · ${live.tok_s} tok/s`
}

const PREFIX: Record<JobSnippet["kind"], string> = {
  stat: "",
  beat: "Noted",
  person: "Met",
  place: "Place",
  loot: "Loot",
  character: "",
}

export function snippetText(s: JobSnippet): string {
  return [PREFIX[s.kind], s.at, s.text].filter(Boolean).join(" · ")
}

/**
 * The next find to show: the model's newest unseen one; with none, the code-counted stats in turn (the
 * model is still reading); with no stats either, its finds in turn. `turn` counts those repeats.
 */
export function pickSnippet(all: JobSnippet[], seen: Set<string>, turn: number): JobSnippet | null {
  const found = all.filter((s) => s.kind !== "stat")
  const fresh = found.find((s) => !seen.has(snippetText(s)))
  if (fresh) return fresh
  const stats = all.filter((s) => s.kind === "stat")
  const pool = stats.length ? stats : found
  return pool.length ? pool[turn % pool.length]! : null
}
