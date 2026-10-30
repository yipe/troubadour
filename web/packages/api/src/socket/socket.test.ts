import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSocket } from "./index.ts"

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  drop() {
    this.onclose?.()
  }
}
const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal("WebSocket", FakeWebSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("createSocket", () => {
  it("defaults to ws://<host>/ws", () => {
    createSocket().connect()
    expect(last().url).toBe(`ws://${location.host}/ws`)
  })

  it("reconnects with doubling backoff capped at 5 s, and resets after an open", () => {
    const socket = createSocket({ url: "ws://x/ws" })
    const states: boolean[] = []
    socket.onStatus((c) => states.push(c))
    socket.connect()
    last().open()
    expect(socket.connected()).toBe(true)
    last().drop()
    expect(socket.connected()).toBe(false)
    // Failed attempts: waits are 500, 1000, 2000, 4000, 5000, 5000.
    const waits = [500, 1000, 2000, 4000, 5000, 5000]
    for (const wait of waits) {
      const count = FakeWebSocket.instances.length
      vi.advanceTimersByTime(wait - 1)
      expect(FakeWebSocket.instances).toHaveLength(count)
      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(count + 1)
      last().drop()
    }
    // A successful open resets the delay.
    vi.advanceTimersByTime(5000)
    last().open()
    last().drop()
    const count = FakeWebSocket.instances.length
    vi.advanceTimersByTime(500)
    expect(FakeWebSocket.instances).toHaveLength(count + 1)
    expect(states).toEqual([true, false, true, false])
  })

  it("delivers typed data to handlers; unsubscribe works", () => {
    const socket = createSocket({ url: "ws://x/ws" })
    socket.connect()
    last().open()
    const typed = vi.fn()
    const all = vi.fn()
    const off = socket.on("error", (data) => typed(data.message))
    socket.onAny(all)
    last().receive({ type: "error", data: { message: "boom" } })
    last().receive({ type: "campaign.updated", data: {} })
    expect(typed).toHaveBeenCalledTimes(1)
    expect(typed).toHaveBeenCalledWith("boom")
    expect(all).toHaveBeenCalledTimes(2)
    off()
    last().receive({ type: "error", data: { message: "again" } })
    expect(typed).toHaveBeenCalledTimes(1)
  })

  it("ignores malformed frames", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const socket = createSocket({ url: "ws://x/ws" })
    const all = vi.fn()
    socket.onAny(all)
    socket.connect()
    last().onmessage?.({ data: "{nope" })
    expect(all).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
  })

  it("close stops reconnecting", () => {
    const socket = createSocket({ url: "ws://x/ws" })
    socket.connect()
    last().open()
    socket.close()
    vi.advanceTimersByTime(10_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.connected()).toBe(false)
  })
})
