import { describe, expect, it } from "vitest"
import { activeTab } from "./tabs.ts"

describe("activeTab", () => {
  it.each([
    ["/", "home"],
    ["/sessions", "sessions"],
    ["/sessions/12/review", "sessions"],
    ["/sessions/live", "sessions"],
    ["/codex/Orsa", "codex"],
    ["/settings/models", ""],
    ["/welcome/campaign", ""],
  ])("%s is %j", (path, tab) => expect(activeTab(path)).toBe(tab))
})
