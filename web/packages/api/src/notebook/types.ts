import type { Schemas } from "../generated/index.ts"

export type NotebookStatus = NotebookItem["status"]
/** One thing the notebook pass noticed: a fact, a change to one, a new entry or a spelling fix. */
export type NotebookItem = Schemas["NotebookItem"]
/** A moment the GM marked during the session. */
export type Pin = Schemas["Pin"]
/** Tonight's notebook (live), or a saved session's. */
export type Notebook = Schemas["Notebook"]
