import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { message, player, session, snapshot, voice, audioLevel, audioQuality } from "../testing/index.ts"
import { currentLevel, litSegments, meterPosition, subscribeLevel, useAudio, zoneOf } from "./audio.ts"
import { sessionTimeNow } from "./hooks.ts"
import { resetLive, wireLive } from "./index.ts"
import { SPEAKING_CLEAR_MS, useSpeaking } from "./speaking.ts"
import { applyEvent, setOnError, useLiveStore } from "./store.ts"

const state = () => useLiveStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  resetLive()
})
afterEach(() => vi.useRealTimers())

const snap = (over = {}) => ({ type: "snapshot" as const, data: snapshot(over) })

describe("applyEvent", () => {
  it("snapshot replaces everything", () => {
    applyEvent({ type: "message.created", data: message({ id: "old" }) })
    applyEvent({ type: "player.upserted", data: player({ id: "old" }) })
    applyEvent(
      snap({
        session: session({ t: 12 }),
        players: [player({ id: "p1" })],
        voices: [voice({ id: "v1" })],
        messages: [message({ id: "m1" })],
      }),
    )
    const s = state()
    expect(s.loaded).toBe(true)
    expect(s.session?.t).toBe(12)
    expect(s.players.map((p) => p.id)).toEqual(["p1"])
    expect(s.voices.map((v) => v.id)).toEqual(["v1"])
    expect(s.messages.map((m) => m.id)).toEqual(["m1"])
  })

  it("message.created is idempotent by id", () => {
    applyEvent({ type: "message.created", data: message({ id: "m1", text: "a" }) })
    applyEvent({ type: "message.created", data: message({ id: "m1", text: "b" }) })
    expect(state().messages).toHaveLength(1)
    expect(state().messages[0]?.text).toBe("b")
  })

  it("messages.updated patches in one update, ignores unknown ids, replaces text and fixes wholesale", () => {
    const fix = { start: 0, end: 1, heard: "y" }
    applyEvent({ type: "message.created", data: message({ id: "m1", text: "x", fixes: [fix] }) })
    applyEvent({ type: "message.created", data: message({ id: "m2", voice_id: "v1" }) })
    let updates = 0
    const unsub = useLiveStore.subscribe(() => updates++)
    applyEvent({
      type: "messages.updated",
      data: [
        { id: "m1", provisional: true },
        { id: "m2", voice_id: "v2", text: "hi", fixes: [] },
        { id: "nope", text: "ignored" },
      ],
    })
    unsub()
    expect(updates).toBe(1)
    const [m1, m2] = state().messages
    expect(m1).toMatchObject({ provisional: true, text: "x", fixes: [fix] })
    expect(m2).toMatchObject({ voice_id: "v2", text: "hi", fixes: [] })
    expect(state().messages).toHaveLength(2)
    expect(state().bumps).toEqual({ m1: 1, m2: 1 })
    applyEvent({ type: "messages.updated", data: [{ id: "m1", text: "z", fixes: [] }] })
    expect(state().messages[0]).toMatchObject({ text: "z", fixes: [] })
  })

  it("messages.updated with only unknown ids changes nothing", () => {
    applyEvent({ type: "message.created", data: message({ id: "m1" }) })
    const before = state().messages
    applyEvent({ type: "messages.updated", data: [{ id: "nope", text: "x" }] })
    expect(state().messages).toBe(before)
  })

  it("message.created keeps t_start order for out-of-order ids and stays addressable", () => {
    applyEvent({ type: "message.created", data: message({ id: "a", t_start: 1 }) })
    applyEvent({ type: "message.created", data: message({ id: "c", t_start: 3 }) })
    applyEvent({ type: "message.created", data: message({ id: "b", t_start: 2 }) })
    expect(state().messages.map((m) => m.id)).toEqual(["a", "b", "c"])
    applyEvent({ type: "messages.updated", data: [{ id: "c", text: "late" }] })
    expect(state().messages.map((m) => m.text)).toEqual(["", "", "late"])
  })

  it("snapshot sorts messages only if they arrive out of order", () => {
    const ordered = [message({ id: "a", t_start: 1 }), message({ id: "b", t_start: 2 })]
    applyEvent(snap({ messages: ordered }))
    expect(state().messages).toBe(ordered)
    applyEvent(snap({ messages: [...ordered].reverse() }))
    expect(state().messages.map((m) => m.id)).toEqual(["a", "b"])
  })

  it("lookups survive the store being replaced outside applyEvent", () => {
    applyEvent({ type: "message.created", data: message({ id: "m1" }) })
    useLiveStore.setState({ messages: [message({ id: "other" }), message({ id: "m1", text: "fresh" })] })
    applyEvent({ type: "messages.updated", data: [{ id: "m1", provisional: true }] })
    expect(state().messages[1]).toMatchObject({ id: "m1", text: "fresh", provisional: true })
  })

  it("voice.upserted and voice.removed (merged_into drops the merged voice)", () => {
    applyEvent({ type: "voice.upserted", data: voice({ id: "v1" }) })
    applyEvent({ type: "voice.upserted", data: voice({ id: "v1", status: "named", player_id: "p1" }) })
    applyEvent({ type: "voice.upserted", data: voice({ id: "v2" }) })
    expect(state().voices).toHaveLength(2)
    expect(state().voices[0]?.player_id).toBe("p1")
    applyEvent({ type: "voice.removed", data: { id: "v1", merged_into: "v2" } })
    expect(state().voices.map((v) => v.id)).toEqual(["v2"])
    applyEvent({ type: "messages.updated", data: [] })
  })

  it("player.upserted and player.removed", () => {
    applyEvent({ type: "player.upserted", data: player({ id: "p1", name: "Priya" }) })
    applyEvent({ type: "player.upserted", data: player({ id: "p1", name: "Priya B" }) })
    expect(state().players).toEqual([player({ id: "p1", name: "Priya B" })])
    applyEvent({ type: "player.removed", data: { id: "p1" } })
    expect(state().players).toEqual([])
  })

  it("session.updated replaces the session; train.status is keyed by player", () => {
    const next = session({ status: "running", training: { player_id: "p1" }, error: "models failed" })
    applyEvent({ type: "session.updated", data: next })
    expect(state().session).toEqual(next)
    const train = { player_id: "p1" } as never
    applyEvent({ type: "train.status", data: train })
    expect(state().train.p1).toBe(train)
  })

  it("error goes to the onError callback; unrelated events are ignored", () => {
    const onError = vi.fn()
    setOnError(onError)
    applyEvent({ type: "error", data: { message: "boom" } })
    expect(onError).toHaveBeenCalledWith("boom")
    const before = state()
    applyEvent({ type: "campaign.updated", data: {} })
    expect(state()).toBe(before)
  })
})

describe("session clock", () => {
  it("interpolates while running at the source speed", () => {
    vi.setSystemTime(0)
    vi.spyOn(performance, "now").mockReturnValue(1000)
    applyEvent({
      type: "session.updated",
      data: session({ status: "running", t: 10, source: { kind: "file", name: "a", speed: 2 } }),
    })
    vi.spyOn(performance, "now").mockReturnValue(3000)
    expect(sessionTimeNow()).toBe(14)
    vi.restoreAllMocks()
  })
})

describe("speaking and audio", () => {
  it("speaker.active is separate from the live store and auto-clears after 1.5 s", () => {
    const sockets = fakeSocket()
    wireLive(sockets)
    applyEvent({ type: "message.created", data: message({ id: "m1" }) })
    const before = state()
    sockets.emit({ type: "speaker.active", data: { voice_id: "v1", confidence: 0.9 } })
    expect(useSpeaking.getState().voiceId).toBe("v1")
    expect(state()).toBe(before)
    vi.advanceTimersByTime(SPEAKING_CLEAR_MS)
    expect(useSpeaking.getState().voiceId).toBeNull()
  })

  it("levels are pub/sub; quality and mic.test live in the audio store", () => {
    const sockets = fakeSocket()
    wireLive(sockets)
    const seen = vi.fn()
    const off = subscribeLevel("session", seen)
    const level = audioLevel({ source: "session", db: -20 })
    sockets.emit({ type: "audio.level", data: level })
    expect(seen).toHaveBeenCalledWith(level)
    expect(currentLevel("session")).toBe(level)
    off()
    sockets.emit({ type: "audio.level", data: level })
    expect(seen).toHaveBeenCalledTimes(1)
    sockets.emit({ type: "audio.quality", data: audioQuality({ source: "test" }) })
    expect(useAudio.getState().quality.test).toBeDefined()
    sockets.emit({ type: "mic.test", data: { state: "running" } })
    expect(useAudio.getState()).toMatchObject({ micTest: "running", quality: { test: undefined } })
  })

  it("zone helpers", () => {
    expect(zoneOf(-60)).toBe("silent")
    expect(zoneOf(-20)).toBe("good")
    expect(zoneOf(-1)).toBe("clip")
    expect(litSegments(null)).toBe(0)
    expect(meterPosition(-80)).toBe(0)
    expect(meterPosition(5)).toBe(1)
  })
})

function fakeSocket() {
  const any = new Set<(ev: never) => void>()
  const status = new Set<(c: boolean) => void>()
  return {
    connect() {},
    close() {},
    on: () => () => {},
    onAny: (h: (ev: never) => void) => (any.add(h), () => any.delete(h)),
    connected: () => false,
    onStatus: (h: (c: boolean) => void) => (status.add(h), () => status.delete(h)),
    emit: (ev: unknown) => any.forEach((h) => h(ev as never)),
  } as never as import("../socket/index.ts").Socket & { emit: (ev: unknown) => void }
}

describe("wireLive", () => {
  it("mirrors connection status and routes events; unsubscribe stops it", () => {
    const sockets = fakeSocket()
    const off = wireLive(sockets)
    sockets.emit({ type: "player.upserted", data: player({ id: "p1" }) })
    expect(state().players).toHaveLength(1)
    off()
    sockets.emit({ type: "player.upserted", data: player({ id: "p2" }) })
    expect(state().players).toHaveLength(1)
  })
})
