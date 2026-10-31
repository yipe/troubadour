import type { BackupAttempt } from "@troubadour/api/cloud"

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

/** "Today, 7:42 pm" or "Oct 22, 10:31 pm". `nowMs` is a `Date.now()` value. */
export function attemptTime(epochS: number, nowMs: number): string {
  const when = new Date(epochS * 1000)
  const today = when.toDateString() === new Date(nowMs).toDateString()
  const clock = CLOCK.format(when).replace(/\s?([AP])M$/, (_, p: string) => ` ${p.toLowerCase()}m`)
  return `${today ? "Today" : DAY.format(when)}, ${clock}`
}

/** What the attempt did: the server's summary, else the count of changed files, else why it failed. */
export function attemptSummary(a: BackupAttempt): string {
  if (!a.ok) return `Failed: ${a.error ?? "unknown error"}`
  if (a.message) return a.message
  return a.changed === 0 ? "No changes" : `${a.changed.toLocaleString("en-US")} notes changed`
}
