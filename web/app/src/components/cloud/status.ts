import type { CloudStatus } from "@troubadour/api/cloud"
import { ago } from "../../lib/format.ts"

/** What the chip cannot read from the status itself: a backup job running, and a live session. */
export interface CloudContext {
  backingUp?: boolean
  /** A session is running or paused. `paused_live` has no event when a session ends with nothing to back up, so it only counts while this is true. */
  live?: boolean
}

export type CloudState = "off" | "backing-up" | "failed" | "paused" | "never" | "ok"

export type CloudTone = "neutral" | "accent" | "danger" | "warning" | "success"

export function cloudState(status: CloudStatus, ctx: CloudContext = {}): CloudState {
  if (!status.connected) return "off"
  if (ctx.backingUp) return "backing-up"
  const failedAt = status.last_error?.at
  if (failedAt !== undefined && failedAt > (status.last_backup?.at ?? 0)) return "failed"
  if (status.paused_live && ctx.live) return "paused"
  return status.last_backup ? "ok" : "never"
}

export function cloudTone(status: CloudStatus, ctx: CloudContext = {}): CloudTone {
  const tones: Record<CloudState, CloudTone> = {
    off: "neutral",
    "backing-up": "accent",
    failed: "danger",
    paused: "warning",
    never: "neutral",
    ok: "success",
  }
  return tones[cloudState(status, ctx)]
}

/** The chip's text, and the headline in the popover: "Backed up 4 min ago". `now` is a `Date.now()` value. */
export function cloudChipLabel(status: CloudStatus, now: number, ctx: CloudContext = {}): string {
  switch (cloudState(status, ctx)) {
    case "off":
      return "Cloud backup"
    case "backing-up":
      return "Backing up…"
    case "failed":
      return "Backup failed"
    case "paused":
      return "Paused during session"
    case "never":
      return "Not backed up yet"
    case "ok":
      return `Backed up ${ago(status.last_backup!.at, now)}`
  }
}

/** The short word beside the popover title. */
export function cloudStateWord(status: CloudStatus, ctx: CloudContext = {}): string {
  const words: Record<CloudState, string> = {
    off: "Not connected",
    "backing-up": "Backing up…",
    failed: "Backup failed",
    paused: "Paused",
    never: "Waiting for first backup",
    ok: "Up to date",
  }
  return words[cloudState(status, ctx)]
}
