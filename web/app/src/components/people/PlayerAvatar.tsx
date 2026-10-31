import type { Player } from "@troubadour/api/players"
import { useClasses } from "@troubadour/api/players"
import type { RecordPlayer } from "@troubadour/api/sessions"
import { Avatar, type AvatarProps } from "@troubadour/ui/avatar"
import { initials, playerColor } from "../../lib/players.ts"

export type PlayerAvatarProps = {
  /** A live player or a saved record's player; or give `name` (and `color`) alone for an unnamed voice. */
  player?: Player | RecordPlayer
  name?: string
  /** A CSS colour; wins over the player's own. */
  color?: string
  size?: AvatarProps["size"]
  className?: string
}

export function PlayerAvatar({ player, name, color, size, className }: PlayerAvatarProps) {
  const classes = useClasses().data ?? []
  const label = player?.name ?? name ?? ""
  // A deleted class id or a missing colour falls through inside playerColor; with no player at all,
  // the muted foreground keeps an unnamed voice from borrowing someone's colour.
  const resolved = color ?? (player ? playerColor(player, classes) : "var(--color-fg-subtle)")
  const avatar = player && "avatar" in player ? (player.avatar ?? undefined) : undefined
  return <Avatar initials={initials(label)} color={resolved} size={size} src={avatar} className={className} />
}
