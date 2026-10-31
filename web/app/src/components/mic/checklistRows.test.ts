import { describe, expect, it } from "vitest"
import { audioQuality } from "@troubadour/api/testing"
import { checklistRows } from "./checklistRows.ts"

describe("checklistRows", () => {
  it("maps checks to tones and appends level and noise from the quality", () => {
    const rows = checklistRows(
      [
        { id: "around", label: "A", ok: true, detail: "Omni" },
        { id: "wired", label: "B", ok: false, detail: "" },
        { id: "rate", label: "C", ok: null, detail: "" },
      ],
      audioQuality({
        speech_db: -18.4,
        grades: { speech: "good", noise: "poor", snr: "ok", rumble: "ok", clipping: "good" },
      }),
    )
    expect(rows.map((r) => [r.id, r.tone, r.value])).toEqual([
      ["around", "ok", "Omni"],
      ["wired", "warn", ""],
      ["rate", "none", ""],
      ["level", "ok", "-18 dB avg"],
      ["noise", "warn", "high"],
    ])
  })
})
