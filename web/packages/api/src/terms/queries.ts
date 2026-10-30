import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keys } from "../query/keys.ts"
import { addTerms, removeTerm, terms, uploadTerms } from "./endpoints.ts"
import type { TermsQuery } from "./types.ts"

export function useTerms(query: TermsQuery) {
  return useQuery({
    queryKey: keys.terms(query),
    queryFn: () => terms(query),
    placeholderData: keepPreviousData, // typing in the search box doesn't blank the list
  })
}

/** Every term query (all pages and filters) is stale after a change. */
function useTermsMutation<TVars, TData>(call: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: call,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.terms() }),
  })
}

export const useAddTerms = () => useTermsMutation(addTerms)
export const useRemoveTerm = () => useTermsMutation(removeTerm)
export const useUploadTerms = () => useTermsMutation(uploadTerms)
