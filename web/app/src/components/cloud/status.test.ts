import { cloudBackup, cloudStatus } from "@troubadour/api/testing"
import { describe, expect, it } from "vitest"
import { cloudChipLabel, cloudState, cloudStateWord, cloudTone } from "./status.ts"

const NOW = 1_760_000_240_000 // 4 minutes after `at` below
const backedUp = cloudStatus({ connected: true, last_backup: cloudBackup({ at: 1_760_000_000 }) })

describe("cloudChipLabel", () => {
  it("offers the backup when not connected", () => {
    expect(cloudChipLabel(cloudStatus(), NOW)).toBe("Cloud backup")
    expect(cloudTone(cloudStatus())).toBe("neutral")
  })

  it("says how long ago the last backup was", () => {
    expect(cloudChipLabel(backedUp, NOW)).toBe("Backed up 4 min ago")
    expect(cloudTone(backedUp)).toBe("success")
    expect(cloudStateWord(backedUp)).toBe("Up to date")
  })

  it("says so before the first backup", () => {
    expect(cloudChipLabel(cloudStatus({ connected: true }), NOW)).toBe("Not backed up yet")
  })

  it("shows a running backup over everything else", () => {
    const failed = { ...backedUp, last_error: { at: 1_760_000_100, message: "offline" } }
    expect(cloudChipLabel(failed, NOW, { backingUp: true })).toBe("Backing up…")
    expect(cloudTone(failed, { backingUp: true })).toBe("accent")
  })

  it("shows a failure newer than the last backup, not an older one", () => {
    const newer = { ...backedUp, last_error: { at: 1_760_000_100, message: "offline" } }
    expect(cloudChipLabel(newer, NOW)).toBe("Backup failed")
    expect(cloudTone(newer)).toBe("danger")
    const older = { ...backedUp, last_error: { at: 1_759_999_000, message: "offline" } }
    expect(cloudState(older)).toBe("ok")
  })

  it("pauses only while a session is live", () => {
    const paused = { ...backedUp, paused_live: true }
    expect(cloudChipLabel(paused, NOW, { live: true })).toBe("Paused during session")
    expect(cloudTone(paused, { live: true })).toBe("warning")
    expect(cloudChipLabel(paused, NOW, { live: false })).toBe("Backed up 4 min ago")
  })
})
