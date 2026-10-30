import { useQuery } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { timeline } from "./endpoints.ts"

/** The Timeline page's rows. Refetched on every mount: write-ups and new sessions change them. */
export function useTimeline() {
  return useQuery({ queryKey: keys.timeline(), queryFn: timeline, refetchOnMount: "always" })
}
