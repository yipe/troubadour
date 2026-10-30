import { useQuery } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { storage } from "./endpoints.ts"

/** The server caches the walk for 60 s, so don't refetch more often than that. */
export function useStorage() {
  return useQuery({ queryKey: keys.storage(), queryFn: storage, staleTime: 60_000 })
}
