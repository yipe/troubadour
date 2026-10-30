import { req, segment } from "../http/index.ts"
import type { Notebook, NotebookItem, NotebookStatus, Pin } from "./types.ts"

/** The live session's notebook; empty when nothing is running. */
export const liveNotebook = () => req<Notebook>("GET", "/api/session/notebook")
export const sessionNotebook = (id: string) => req<Notebook>("GET", `/api/sessions/${segment(id)}/notebook`)
export const addPin = (t: number, text: string) => req<Pin>("POST", "/api/session/pins", { t, text })
export const setNotebookStatus = (itemId: string, status: NotebookStatus) =>
  req<NotebookItem>("POST", `/api/session/notebook/${segment(itemId)}`, { status })
