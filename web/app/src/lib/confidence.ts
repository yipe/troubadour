export type Confidence = "gm" | "theory" | "once"
export type ConfidenceTone = "success" | "warning" | "neutral"

/** How sure we are of a fact, and the badge tone that says so. */
export const CONFIDENCE: Record<Confidence, { label: string; tone: ConfidenceTone }> = {
  gm: { label: "GM stated", tone: "success" },
  theory: { label: "Party theory", tone: "warning" },
  once: { label: "Heard once", tone: "neutral" },
}
