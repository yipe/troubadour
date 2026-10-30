/** A person in the library. `character` and `is_gm` are their seat in the open campaign. */
export interface Player {
  id: string
  name: string
  character: string
  avatar: string | null /* data URL */
  color: string /* hex like #f59e0b */
  trained: boolean
  is_gm: boolean
  clone_ok: boolean /* they agreed to a voice clone; turning it off deletes everything made from it */
}
/** Someone in the library who isn't playing in the open campaign (voice training kept). */
export type LibraryPlayer = Omit<Player, "character" | "is_gm">

/** Progress of a voice-training recording, sent as `train.status`. */
export interface TrainStatus {
  player_id: string
  state: "recording" | "processing" | "done" | "error" | "cancelled"
  seconds_left: number
  level: number /* 0-1 */
  message: string | null
}

export type PlayerPatch = Partial<
  Pick<Player, "name" | "character" | "avatar" | "is_gm" | "color" | "clone_ok">
>
