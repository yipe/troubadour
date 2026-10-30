import { Link } from "react-router"
import { useLive, useSessionTime } from "@troubadour/api/live"
import { paths } from "../paths.ts"

/** h:mm:ss, hours always shown (the nav design reads "1:42:08"). */
function elapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${Math.floor(s / 3600)}:${mm}:${ss}`
}

/** Only while a session is running or paused; links to Live. */
export function RecordingPill() {
  const status = useLive((s) => s.session?.status)
  const t = useSessionTime()
  if (status !== "running" && status !== "paused") return null
  const paused = status === "paused"
  const tone = paused ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger"
  const dot = paused
    ? "bg-warning shadow-[0_0_0_3px_var(--color-warning-bg)]"
    : "bg-danger shadow-[0_0_0_3px_var(--color-danger-bg)]"
  return (
    <Link
      to={paths.live()}
      className={`flex h-[30px] items-center gap-2 rounded-full px-3 text-12 font-bold tracking-[0.06em] hover:text-inherit hover:brightness-125 ${tone}`}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {paused ? "PAUSED" : "RECORDING"}
      <span className="font-semibold tracking-normal text-ink tabular-nums">{elapsed(t)}</span>
    </Link>
  )
}
