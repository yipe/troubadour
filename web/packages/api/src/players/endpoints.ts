import { req, segment } from "../http/index.ts"
import type { DndClass, Player, PlayerPatch } from "./types.ts"

export const createPlayer = (b: {
  name: string
  character?: string
  avatar?: string | null
  is_gm?: boolean
}) => req<Player>("POST", "/api/players", b)

export const updatePlayer = (id: string, b: PlayerPatch) =>
  req<Player>("PATCH", `/api/players/${segment(id)}`, b)

/** Delete from the library: every campaign, voiceprints and training. */
export const deletePlayer = (id: string) => req<void>("DELETE", `/api/players/${segment(id)}`)

/** A library player joins the open campaign; their voice training comes along. Unset fields:
 * their seat from before they left this campaign. */
export const seatPlayer = (id: string, b: { character?: string; is_gm?: boolean } = {}) =>
  req<Player>("POST", `/api/players/${segment(id)}/seat`, b)

/** Out of the open campaign, back to the library (training kept). Between sessions only. */
export const benchPlayer = (id: string) => req<void>("POST", `/api/players/${segment(id)}/bench`)

export const trainPlayer = (id: string, seconds?: number) =>
  req<void>("POST", `/api/players/${segment(id)}/train`, seconds === undefined ? {} : { seconds })

export const cancelTraining = () => req<void>("POST", "/api/train/cancel")

export const classes = () => req<DndClass[]>("GET", "/api/classes")

export const addClass = (b: { label: string; color: string }) => req<DndClass>("POST", "/api/classes", b)

export const updateClass = (id: string, b: { label?: string; color?: string }) =>
  req<DndClass>("PATCH", `/api/classes/${segment(id)}`, b)

/** Players using it keep the id; the UI shows "unknown class". */
export const deleteClass = (id: string) => req<void>("DELETE", `/api/classes/${segment(id)}`)
