import type { Grade, MicCheck, QualityNumbers } from "@troubadour/api/audio"

export type Tone = "ok" | "warn" | "none"

export interface ChecklistRow {
  id: string
  label: string
  value: string
  tone: Tone
}

const NOISE_WORD: Record<Grade, string> = { good: "low", ok: "ok", poor: "high" }
const toneOfGrade = (g: Grade): Tone => (g === "good" ? "ok" : "warn")

/** The mic's own checks first, then what the last test measured. */
export function checklistRows(checks: MicCheck[], quality: QualityNumbers | undefined): ChecklistRow[] {
  const rows: ChecklistRow[] = checks.map((c) => ({
    id: c.id,
    label: c.label,
    value: c.detail,
    tone: c.ok === true ? "ok" : c.ok === false ? "warn" : "none",
  }))
  if (quality) {
    rows.push(
      {
        id: "level",
        label: "Level",
        value: `${quality.speech_db.toFixed(0)} dB avg`,
        tone: toneOfGrade(quality.grades.speech),
      },
      {
        id: "noise",
        label: "Background noise",
        value: NOISE_WORD[quality.grades.noise],
        tone: toneOfGrade(quality.grades.noise),
      },
    )
  }
  return rows
}
