import type { NotesSessionInput } from "@troubadour/api/campaign"

/** What the notes form holds. `past`: no date, before every dated session ("Unknown"); `date` is then ignored. */
export type NotesValues = { date: string; past: boolean; title: string; text: string }

/** The request for what was typed. */
export function notesInput(v: NotesValues): NotesSessionInput {
  return { date: v.past ? null : v.date, title: v.title.trim(), text: v.text }
}
