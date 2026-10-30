import { useMemo, useState } from "react"
import { ChevronDown, Download, Pause, Play, Square } from "lucide-react"
import { useClasses } from "@troubadour/api/players"
import { useLive, useSpeaking } from "@troubadour/api/live"
import type { Player } from "@troubadour/api/players"
import { transcriptUrl, usePauseSession, useResumeSession } from "@troubadour/api/session"
import { useSessions } from "@troubadour/api/sessions"
import { Button } from "@troubadour/ui/button"
import { cn } from "@troubadour/ui/cn"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { StatusDot } from "@troubadour/ui/status-dot"
import { PlayerAvatar } from "../../components/people/PlayerAvatar.tsx"
import { playerColor } from "../../lib/players.ts"
import { nextSessionNumber } from "../../lib/sessions.ts"
import { talkTime } from "../../lib/talk.ts"
import { PendingVoiceCard } from "./PendingVoiceCard.tsx"
import { QualityPopover } from "./QualityPopover.tsx"
import { listeningLabel, newestPending, presentPlayers } from "./rail.ts"
import { SessionAudio } from "./SessionAudio.tsx"
import { VoicesPopover } from "./VoicesPopover.tsx"

export interface SpeakerRailProps {
  onEnd: () => void
}

/** The left column: which session, who is talking and how much, the voice to name, and the controls. */
export function SpeakerRail({ onEnd }: SpeakerRailProps) {
  const session = useLive((s) => s.session)
  const status = session?.status ?? "idle"
  const sessions = useSessions()
  const number = nextSessionNumber(sessions.data ?? [])
  const paused = status === "paused"
  const pause = usePauseSession()
  const resume = useResumeSession()
  const hold = paused ? resume : pause

  return (
    <aside className="flex w-[250px] flex-none flex-col gap-1.5 border-r border-line px-3.5 py-4">
      <h1 className="font-bold">Session {number}</h1>
      {session?.title ? <div className="text-13 text-ink-muted">{session.title}</div> : null}
      <div className={cn("mb-2.5 text-12", paused ? "text-warning" : "text-danger")}>
        <QualityPopover>
          <StatusDot tone={paused ? "warning" : "danger"} pulse={!paused} />
          {status === "stopping"
            ? "Saving…"
            : paused
              ? "Paused · not listening"
              : `Listening · ${listeningLabel(session?.source)}`}
        </QualityPopover>
      </div>
      <Speakers />
      <PendingVoice />
      <div className="flex-1" />
      <div className="flex flex-col gap-1.5">
        <SessionAudio />
        <VoicesPopover />
        {status !== "stopping" && (
          <Button size="lg" disabled={hold.isPending} onClick={() => hold.mutate()}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
        <ExportMenu />
        <Button size="lg" variant="danger" disabled={status === "stopping"} onClick={onEnd}>
          <Square className="size-3.5" /> End session
        </Button>
      </div>
    </aside>
  )
}

function ExportMenu() {
  const hasLines = useLive((s) => s.messages.length > 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!hasLines}
        title={hasLines ? undefined : "Nothing to export yet"}
        render={
          <Button size="lg" variant="ghost">
            <Download className="size-3.5" /> Export <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem render={<a href={transcriptUrl("md")} download />}>Markdown</DropdownMenuItem>
        <DropdownMenuItem render={<a href={transcriptUrl("json")} download />}>JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Speakers() {
  const players = useLive((s) => s.players)
  const voices = useLive((s) => s.voices)
  const messages = useLive((s) => s.messages)
  const present = useLive((s) => s.session?.present_player_ids)
  const speakingVoice = useSpeaking((s) => s.voiceId)
  const classes = useClasses().data ?? []
  const talk = useMemo(() => talkTime(messages, voices, players), [messages, voices, players])
  const shown = presentPlayers(players, present)
  const speakingPlayer = voices.find((v) => v.id === speakingVoice)?.player_id ?? null

  if (shown.length === 0)
    return (
      <p className="text-13 text-ink-subtle">
        No players yet. Add them in Settings, or name voices as they appear.
      </p>
    )

  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((p) => (
        <SpeakerRow
          key={p.id}
          player={p}
          color={playerColor(p, classes)}
          pct={talk.total > 0 ? Math.round(((talk.byPlayer.get(p.id) ?? 0) / talk.total) * 100) : null}
          speaking={p.id === speakingPlayer}
        />
      ))}
    </ul>
  )
}

function SpeakerRow({
  player,
  color,
  pct,
  speaking,
}: {
  player: Player
  color: string
  pct: number | null
  speaking: boolean
}) {
  const label = player.character || player.name
  const sub = player.character ? player.name : player.is_gm ? "GM" : ""
  return (
    <li
      data-player-id={player.id}
      data-speaking={speaking || undefined}
      style={{ "--player": color } as React.CSSProperties}
      className={cn(
        "flex flex-col gap-1.5 rounded-control px-2.5 py-2 transition-colors duration-200",
        speaking && "bg-surface shadow-[inset_0_0_0_1px_var(--player),0_0_16px_-6px_var(--player)]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <PlayerAvatar player={player} color={color} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-13 font-semibold">{label}</div>
          {sub && <div className="text-11 text-ink-subtle">{sub}</div>}
        </div>
        {pct !== null && (
          <span data-testid="talk-share" className="text-12 text-ink-muted tabular-nums">
            {pct}%
          </span>
        )}
      </div>
      <div className="h-[3px] rounded-[2px] bg-elevated">
        <div className="h-[3px] rounded-[2px] bg-(--player)" style={{ width: `${pct ?? 0}%` }} />
      </div>
    </li>
  )
}

/** The newest unnamed voice, until "Later" hides it; the next new voice shows it again. */
function PendingVoice() {
  const voices = useLive((s) => s.voices)
  const players = useLive((s) => s.players)
  const present = useLive((s) => s.session?.present_player_ids)
  const [laterId, setLaterId] = useState<string | null>(null)
  const voice = newestPending(voices)
  if (!voice || voice.id === laterId) return null
  return (
    <PendingVoiceCard
      key={voice.id}
      voice={voice}
      players={presentPlayers(players, present)}
      onLater={() => {
        setLaterId(voice.id)
      }}
    />
  )
}
