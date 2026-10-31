import type { ServerEvent } from "../events/index.ts"

type EventOf<T extends ServerEvent["type"]> = Extract<ServerEvent, { type: T }>["data"]

export interface Socket {
  connect(): void
  close(): void
  /** Handler for one event type; returns the unsubscribe. */
  on<T extends ServerEvent["type"]>(type: T, handler: (data: EventOf<T>) => void): () => void
  /** Handler for every event; returns the unsubscribe. */
  onAny(handler: (event: ServerEvent) => void): () => void
  connected(): boolean
  /** Called on every open/close with the new state; returns the unsubscribe. */
  onStatus(cb: (connected: boolean) => void): () => void
}

export const BACKOFF_START_MS = 500
export const BACKOFF_CAP_MS = 5000

function defaultUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  return `${proto}://${location.host}/ws`
}

/** One per app (the shell creates it). JSON frames `{type, data}`; reconnects with capped backoff. */
export function createSocket({ url }: { url?: string } = {}): Socket {
  const typed = new Map<string, Set<(data: never) => void>>()
  const any = new Set<(event: ServerEvent) => void>()
  const status = new Set<(connected: boolean) => void>()
  let ws: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let delay = BACKOFF_START_MS
  let wanted = false
  let isConnected = false

  const setConnected = (value: boolean) => {
    if (isConnected === value) return
    isConnected = value
    for (const cb of status) cb(value)
  }

  const open = () => {
    const socket = new WebSocket(url ?? defaultUrl())
    ws = socket
    socket.onopen = () => {
      delay = BACKOFF_START_MS
      setConnected(true)
    }
    socket.onmessage = (e) => {
      let event: ServerEvent
      try {
        event = JSON.parse(e.data as string) as ServerEvent
      } catch (err) {
        console.error("bad server event", err)
        return
      }
      for (const h of typed.get(event.type) ?? []) h(event.data as never)
      for (const h of any) h(event)
    }
    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      setConnected(false)
      if (!wanted) return
      timer = setTimeout(open, delay)
      delay = Math.min(delay * 2, BACKOFF_CAP_MS)
    }
  }

  return {
    connect() {
      if (wanted) return
      wanted = true
      open()
    },
    close() {
      wanted = false
      clearTimeout(timer)
      const socket = ws
      ws = null
      socket?.close()
      setConnected(false)
    },
    on(type, handler) {
      const set = typed.get(type) ?? new Set()
      typed.set(type, set)
      set.add(handler as (data: never) => void)
      return () => set.delete(handler as (data: never) => void)
    },
    onAny(handler) {
      any.add(handler)
      return () => any.delete(handler)
    },
    connected: () => isConnected,
    onStatus(cb) {
      status.add(cb)
      return () => status.delete(cb)
    },
  }
}
