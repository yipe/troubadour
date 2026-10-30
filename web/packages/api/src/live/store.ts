import { create } from "zustand"
import type { ServerEvent } from "../events/index.ts"
import type { LibraryPlayer, Player, TrainStatus } from "../players/types.ts"
import type { Message, Session, Snapshot, Voice } from "../session/types.ts"

/** Only the running session. Everything else the server owns goes through query hooks. */
export interface LiveState {
  connected: boolean
  loaded: boolean
  /** Only ever written from WS `snapshot` / `session.updated`. */
  session: Session | null
  /** performance.now() when `session` was received, for client-side clock interpolation */
  sessionAt: number
  players: Player[]
  /** People not playing in the open campaign (their voice training is kept). */
  library: LibraryPlayer[]
  voices: Voice[]
  messages: Message[]
  /** message id -> update counter, used to replay the "updated" flash */
  bumps: Record<string, number>
  train: Record<string, TrainStatus>
  focus: { voiceId: string; n: number } | null
}

const initial: LiveState = {
  connected: false,
  loaded: false,
  session: null,
  sessionAt: 0,
  players: [],
  library: [],
  voices: [],
  messages: [],
  bumps: {},
  train: {},
  focus: null,
}

export const useLiveStore = create<LiveState>(() => initial)

const set = useLiveStore.setState

let onError: (message: string) => void = () => {}

/** Where `error` events go (the app passes its toast). */
export function setOnError(handler: (message: string) => void) {
  onError = handler
}

export function resetStore() {
  onError = () => {}
  set(initial, true)
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export const liveActions = {
  setConnected: (connected: boolean) => set({ connected }),
  focusVoice: (voiceId: string) => set((s) => ({ focus: { voiceId, n: (s.focus?.n ?? 0) + 1 } })),
  clearTrain: (playerId: string) =>
    set((s) => {
      const train = { ...s.train }
      delete train[playerId]
      return { train }
    }),
}

/** The server sends messages in t_start order; only sort (stably) if a snapshot isn't. */
function inServerOrder(messages: Message[]): Message[] {
  for (let i = 1; i < messages.length; i++) {
    if (messages[i]!.t_start < messages[i - 1]!.t_start)
      return [...messages].sort((a, b) => a.t_start - b.t_start)
  }
  return messages
}

/**
 * id -> index into `messages`, kept in sync with the array it was built for. Any write to
 * `messages` outside this module (e.g. tests resetting the store) is detected by identity and
 * triggers a rebuild, so lookups stay O(1) on the hot path without ever going stale.
 */
let messageIndex = new Map<string, number>()
let indexedMessages: Message[] | null = null

function indexFor(messages: Message[]): Map<string, number> {
  if (indexedMessages !== messages) {
    messageIndex = new Map(messages.map((m, i) => [m.id, i]))
    indexedMessages = messages
  }
  return messageIndex
}

/** Record that `next` replaced the indexed array with the same id -> index layout. */
function reindexed(next: Message[]): Message[] {
  indexedMessages = next
  return next
}

/**
 * Insert or replace a message, keeping server (t_start) order. New messages almost always
 * belong at the end; an out-of-order one is placed by binary search and forces a reindex.
 */
function addMessage(messages: Message[], m: Message): Message[] {
  const index = indexFor(messages)
  const existing = index.get(m.id)
  if (existing !== undefined) {
    const next = messages.slice()
    next[existing] = m
    return reindexed(next)
  }
  const last = messages[messages.length - 1]
  if (!last || last.t_start <= m.t_start) {
    index.set(m.id, messages.length)
    return reindexed([...messages, m])
  }
  let lo = 0
  let hi = messages.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (messages[mid]!.t_start <= m.t_start) lo = mid + 1
    else hi = mid
  }
  return [...messages.slice(0, lo), m, ...messages.slice(lo)]
}

function applySnapshot(snap: Snapshot) {
  set({
    loaded: true,
    session: snap.session,
    sessionAt: performance.now(),
    players: snap.players,
    library: snap.library,
    voices: snap.voices,
    messages: inServerOrder(snap.messages),
    bumps: {},
  })
}

/**
 * Apply one server event. Event types that only concern other stores (audio, speaking) or the
 * query cache (campaign.*, cloud, llm, campaigns) are ignored here.
 */
export function applyEvent(ev: ServerEvent) {
  switch (ev.type) {
    case "snapshot":
      return applySnapshot(ev.data)
    case "session.updated":
      return set({ session: ev.data, sessionAt: performance.now() })
    case "player.upserted":
      return set((s) => ({ players: upsert(s.players, ev.data) }))
    case "player.removed":
      return set((s) => ({ players: s.players.filter((p) => p.id !== ev.data.id) }))
    case "library.updated":
      return set({ library: ev.data })
    case "voice.upserted":
      return set((s) => ({ voices: upsert(s.voices, ev.data) }))
    case "voice.removed":
      // On merges the server re-points affected messages via a following `messages.updated`.
      return set((s) => ({ voices: s.voices.filter((v) => v.id !== ev.data.id) }))
    case "message.created":
      return set((s) => ({ messages: addMessage(s.messages, ev.data) }))
    case "messages.updated": {
      const patches = ev.data
      return set((s) => {
        const index = indexFor(s.messages)
        const messages = s.messages.slice()
        const bumps = { ...s.bumps }
        let changed = false
        for (const patch of patches) {
          const i = index.get(patch.id)
          if (i === undefined) continue
          // Fields present in the patch replace the old ones wholesale (text and fixes arrive
          // together and fit each other).
          messages[i] = { ...messages[i]!, ...patch } as Message
          bumps[patch.id] = (bumps[patch.id] ?? 0) + 1
          changed = true
        }
        return changed ? { messages: reindexed(messages), bumps } : {}
      })
    }
    case "train.status":
      return set((s) => ({ train: { ...s.train, [ev.data.player_id]: ev.data } }))
    case "error":
      return onError(ev.data.message)
    default:
      return
  }
}
