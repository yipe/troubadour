import { campaignJob } from "@troubadour/api/testing"
import { describe, expect, it } from "vitest"
import { elapsed, jobActive, jobCount, jobFraction, liveText, pickSnippet, snippetText } from "./progress.ts"

const stat = (text: string) => ({ kind: "stat" as const, at: "", text })

describe("progress maths", () => {
  it("formats elapsed time in h, m and s", () => {
    expect(elapsed(42)).toBe("42 s")
    expect(elapsed(240)).toBe("4 m 00 s")
    expect(elapsed(134)).toBe("2 m 14 s")
    expect(elapsed(3725)).toBe("1 h 02 m 05 s")
    expect(elapsed(-5)).toBe("0 s")
  })

  it("words what the model is doing", () => {
    const live = { tokens: 1234, tok_s: 27.5, started: 100 }
    expect(liveText({ ...live, phase: "reading" }, 234)).toBe("Reading… 2 m 14 s")
    expect(liveText({ ...live, phase: "writing" }, 234)).toBe("Writing · 1,234 tokens · 27.5 tok/s")
    expect(liveText({ ...live, phase: "thinking" }, 234)).toBe("Thinking · 1,234 tokens · 27.5 tok/s")
  })

  it("prefers the model's fraction over done/total", () => {
    expect(jobFraction(campaignJob({ id: "a", done: 2, total: 5 }))).toBe(0.4)
    expect(jobFraction(campaignJob({ id: "a" }))).toBeNull()
    const live = { phase: "writing" as const, tokens: 0, tok_s: 0, started: 0, fraction: 0.7 }
    expect(jobFraction(campaignJob({ id: "a", done: 2, total: 5, live }))).toBe(0.7)
  })

  it("counts and classifies jobs", () => {
    expect(jobCount(campaignJob({ id: "a", done: 2, total: 5 }))).toBe("2/5")
    expect(jobCount(campaignJob({ id: "a" }))).toBe("")
    expect(jobActive(campaignJob({ id: "a", state: "running" }))).toBe(true)
    expect(jobActive(campaignJob({ id: "a", state: "done" }))).toBe(false)
  })

  it("picks the newest unseen find, else cycles the stats, else the finds", () => {
    const beat = { kind: "beat" as const, at: "1:14", text: "A swallow" }
    expect(snippetText(beat)).toBe("Noted · 1:14 · A swallow")
    const all = [stat("a"), stat("b"), beat]
    expect(pickSnippet(all, new Set(), 0)).toBe(beat)
    const seen = new Set([snippetText(beat)])
    expect(pickSnippet(all, seen, 0)?.text).toBe("a")
    expect(pickSnippet(all, seen, 1)?.text).toBe("b")
    expect(pickSnippet(all, seen, 2)?.text).toBe("a")
    expect(pickSnippet([beat], seen, 3)).toBe(beat)
    expect(pickSnippet([], seen, 0)).toBeNull()
  })
})
