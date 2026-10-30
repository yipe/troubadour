import { req, segment } from "../http/index.ts"
import type { MicInfo, MicSpecsPatch } from "./types.ts"

/** A sample file the server lists in `SourceList.files`, played back for file sources. */
export const fileUrl = (name: string) => `/api/files/${segment(name)}`

export const mics = () => req<MicInfo[]>("GET", "/api/mics")

export const updateMic = (name: string, b: MicSpecsPatch) =>
  req<MicInfo>("PATCH", `/api/mics/${segment(name)}`, b)

/** Open the mic for a while without a session (level + quality events, source "test"). */
export const startMicTest = (device: string | null, seconds?: number) =>
  req<{ state: "running"; device: string | null; seconds: number }>(
    "POST",
    "/api/mic/test",
    seconds === undefined ? { device } : { device, seconds },
  )

export const stopMicTest = () => req<unknown>("POST", "/api/mic/test/stop")

/** Live session level + quality read-out on/off (off: the server skips that work). */
export const setAudioMonitor = (on: boolean) => req<{ on: boolean }>("PUT", "/api/audio/monitor", { on })
