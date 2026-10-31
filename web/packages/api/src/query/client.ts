import { QueryClient } from "@tanstack/react-query"

/** Mutation errors are not thrown globally: the page that fired the mutation shows `error`. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  })
}
