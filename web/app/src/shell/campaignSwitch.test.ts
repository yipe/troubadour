import { describe, expect, it } from "vitest"
import { campaignSwitchTarget } from "./campaignSwitch.ts"

describe("campaignSwitchTarget", () => {
  it("leaves the open codex entry and the saved session of the old campaign", () => {
    expect(campaignSwitchTarget("/codex/Orsa")).toBe("/codex")
    expect(campaignSwitchTarget("/sessions/12/review")).toBe("/sessions")
  })

  it("stays put on pages that belong to no campaign object", () => {
    for (const path of ["/", "/codex", "/sessions", "/sessions/new", "/sessions/live", "/facts"])
      expect(campaignSwitchTarget(path)).toBeNull()
  })
})
