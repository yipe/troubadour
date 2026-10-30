// Every formatter pins the "en-US" locale: with `undefined` the output depends on the machine.

const pad2 = (n: number) => String(n).padStart(2, "0")
const whole = (seconds: number) => Math.max(0, Math.floor(seconds))

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" })
const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })

/** "1:38:02" from an hour on, else "38:02". Fractions are floored. */
export function hms(seconds: number): string {
  const s = whole(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`
}

/** "1:38": hours and minutes. */
export function hm(seconds: number): string {
  const s = whole(seconds)
  return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}`
}

/** "3 h 12 m", "45 m" or "40 s". */
export function duration(seconds: number): string {
  const s = whole(seconds)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} m`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`
}

/** "3:12" (h:mm), for tight spots such as a session row. */
export function durationShort(seconds: number): string {
  return hm(seconds)
}

/** "Oct 22" */
export function dateShort(epochS: number): string {
  return SHORT_DATE.format(new Date(epochS * 1000))
}

/** "Thursday, October 22" */
export function dateLong(epochS: number): string {
  return LONG_DATE.format(new Date(epochS * 1000))
}

function clockParts(epochS: number): { time: string; period: string } {
  const parts = CLOCK.formatToParts(new Date(epochS * 1000))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return { time: `${get("hour")}:${get("minute")}`, period: get("dayPeriod").toLowerCase() }
}

/** "7:04 – 10:16 pm"; the am/pm is spelled out on both ends only when they differ. */
export function timeRange(startEpochS: number, endEpochS: number): string {
  const start = clockParts(startEpochS)
  const end = clockParts(endEpochS)
  const from = start.period === end.period ? start.time : `${start.time} ${start.period}`
  return `${from} – ${end.time} ${end.period}`
}

/** "just now", "4 min ago", "3 h ago", then the date ("Oct 22"). `nowMs` is a `Date.now()` value. */
export function ago(epochS: number, nowMs: number): string {
  const seconds = Math.max(0, nowMs / 1000 - epochS)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return dateShort(epochS)
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"]

/** "3.1 GB" (1024-based, one decimal from KB up). */
export function bytes(n: number): string {
  let value = Math.max(0, n)
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`
}
