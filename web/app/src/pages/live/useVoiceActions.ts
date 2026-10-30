import { useMutation } from "@tanstack/react-query"
import { applyEvent } from "@troubadour/api/live"
import type { Player } from "@troubadour/api/players"
import { assignVoice, unassignVoice, type Voice } from "@troubadour/api/session"
import { notify } from "@troubadour/ui/toast"
import { assignedMessage } from "./rail.ts"

const failed = (e: Error) => notify(e.message, { tone: "danger" })

/**
 * Name a voice. The WebSocket also announces the change; applying the answer here makes the card go
 * away at once and costs nothing when the event repeats it.
 */
export function useAssignVoice() {
  return useMutation({
    mutationFn: ({ voice, player, character }: { voice: Voice; player: Player; character: string | null }) =>
      assignVoice(voice.id, player.id, character),
    onSuccess: ({ voice: updated, merged_into }, { voice, player, character }) => {
      if (merged_into) applyEvent({ type: "voice.removed", data: { id: voice.id, merged_into } })
      else applyEvent({ type: "voice.upserted", data: updated })
      notify(assignedMessage(voice, player, character))
    },
    onError: failed,
  })
}

export function useUnassignVoice() {
  return useMutation({
    mutationFn: (voice: Voice) => unassignVoice(voice.id),
    onSuccess: (voice) => applyEvent({ type: "voice.upserted", data: voice }),
    onError: failed,
  })
}
