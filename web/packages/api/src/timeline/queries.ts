import { useQuery } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { appearances, timeline } from "./endpoints.ts"

/** The Timeline page's rows. Refetched on every mount: write-ups and new sessions change them. */
export function useTimeline() {
  return useQuery({ queryKey: keys.timeline(), queryFn: timeline, refetchOnMount: "always" })
}

/**
 * Mentions of every entry per session. Under the campaign key so `campaign.updated` refetches it, like
 * the entity detail.
 */
export function useAppearances() {
  return useQuery({ queryKey: [...keys.campaign(), "appearances"], queryFn: appearances })
}
