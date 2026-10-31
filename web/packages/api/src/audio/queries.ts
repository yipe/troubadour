import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import type { MicInfo, MicSpecsPatch } from "./types.ts"
import { mics, setAudioMonitor, startMicTest, stopMicTest, updateMic } from "./endpoints.ts"

/** `poll`: refetch every 2 s so a plugged-in or removed mic shows up without a reload. */
export function useMics(opts: { poll?: boolean } = {}) {
  return useQuery({ queryKey: keys.mics(), queryFn: mics, refetchInterval: opts.poll ? 2000 : false })
}

export function useUpdateMic() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; patch: MicSpecsPatch }) => updateMic(v.name, v.patch),
    onSuccess: (info) =>
      client.setQueryData<MicInfo[]>(keys.mics(), (list) =>
        list?.map((m) => (m.name === info.name ? info : m)),
      ),
  })
}

// Level / quality arrive as socket events (the live audio store); these only start and stop them.
export const useStartMicTest = () =>
  useMutation({
    mutationFn: (v: { device: string | null; seconds?: number }) => startMicTest(v.device, v.seconds),
  })
export const useStopMicTest = () => useMutation({ mutationFn: stopMicTest })
export const useSetAudioMonitor = () => useMutation({ mutationFn: (on: boolean) => setAudioMonitor(on) })
