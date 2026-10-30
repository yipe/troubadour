import { useMutation, useQuery } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import type { Source } from "./types.ts"
import { pauseSession, recheckLlm, resumeSession, sources, startSession, stopSession } from "./endpoints.ts"

// Session responses are not applied anywhere: the WS events (live store) are the source of truth.

/** Mics and sample files to start from. Live-only: a campaign switch doesn't refetch it. */
export function useSources() {
  return useQuery({ queryKey: keys.sources(), queryFn: sources })
}

export const useStartSession = () => useMutation({ mutationFn: (source: Source) => startSession(source) })
export const usePauseSession = () => useMutation({ mutationFn: pauseSession })
export const useResumeSession = () => useMutation({ mutationFn: resumeSession })
export const useStopSession = () => useMutation({ mutationFn: stopSession })
export const useRecheckLlm = () => useMutation({ mutationFn: recheckLlm })
