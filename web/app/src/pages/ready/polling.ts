import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { keys } from "@troubadour/api/query"

/** How often the idle page re-reads the inputs, so a mic plugged in or removed shows up. */
export const SOURCES_POLL_MS = 2000

/** Re-reads mics and sample files while no session runs. */
export function useIdleSourcesPoll(idle: boolean) {
  const client = useQueryClient()
  useEffect(() => {
    if (!idle) return
    const id = setInterval(() => {
      void client.invalidateQueries({ queryKey: keys.sources() })
      void client.invalidateQueries({ queryKey: keys.mics() })
    }, SOURCES_POLL_MS)
    return () => clearInterval(id)
  }, [idle, client])
}
