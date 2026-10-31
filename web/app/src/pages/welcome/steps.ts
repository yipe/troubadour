import { WELCOME_STEPS, type WelcomeStep } from "../../paths.ts"

export interface StepInfo {
  id: WelcomeStep
  /** The rail's title. */
  title: string
  /** The rail's sub line (the campaign step adds the campaign name). */
  sub: string
  /** "Continue to <this>" on the step before it. */
  continueTo: string
  heading: string
  explainer: string
}

export const STEPS: Record<WelcomeStep, StepInfo> = {
  campaign: {
    id: "campaign",
    title: "Campaign",
    sub: "Name it and pick a vault folder",
    continueTo: "the campaign",
    heading: "Name your campaign",
    explainer:
      "Each campaign keeps its own players, sessions and notes. The vault is a folder of Markdown notes that Obsidian can open.",
  },
  table: {
    id: "table",
    title: "The table",
    sub: "Players, characters, GM",
    continueTo: "the table",
    heading: "Who’s at the table?",
    explainer:
      "Names and characters help Troubadour spell them right. Voices don’t need training: unknown speakers show up as “Voice 1” and you name them once.",
  },
  microphone: {
    id: "microphone",
    title: "Microphone",
    sub: "Check it hears the whole table",
    continueTo: "microphone",
    heading: "Check the microphone",
    explainer:
      "One shared mic hears everyone. Run a short test and say a few words from the far end of the table.",
  },
  notes: {
    id: "notes",
    title: "Existing notes",
    sub: "Import Obsidian or Markdown",
    continueTo: "existing notes",
    heading: "Bring in existing notes",
    explainer:
      "Paste or pick notes you already have and the local model reads them into your campaign wiki. You can skip this and import later.",
  },
  privacy: {
    id: "privacy",
    title: "AI & privacy",
    sub: "Local model or hosted",
    continueTo: "AI & privacy",
    heading: "AI & privacy",
    explainer:
      "Transcription and voices always stay on this computer. Choose where the language model that writes recaps and answers runs.",
  },
}

export function isWelcomeStep(value: string | undefined): value is WelcomeStep {
  return WELCOME_STEPS.some((s) => s === value)
}

export function stepIndex(step: WelcomeStep): number {
  return WELCOME_STEPS.indexOf(step)
}

export type StepState = "done" | "current" | "upcoming"

export function stepState(step: WelcomeStep, current: WelcomeStep): StepState {
  const i = stepIndex(step)
  const now = stepIndex(current)
  return i < now ? "done" : i === now ? "current" : "upcoming"
}
