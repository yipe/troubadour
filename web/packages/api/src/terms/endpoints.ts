import { ApiError, req, segment } from "../http/index.ts"
import type { Terms, TermsAdded, TermsQuery } from "./types.ts"

/** The names the spelling cleanup knows, a page at a time: built-in, your local list, and yours. */
export function terms(query: TermsQuery) {
  const params = new URLSearchParams({ offset: String(query.offset), limit: String(query.limit) })
  if (query.q) params.set("q", query.q)
  if (query.like) params.set("like", query.like)
  if (query.source) params.set("source", query.source)
  return req<Terms>("GET", `/api/terms?${params}`)
}

export const addTerms = (list: { name: string; type: string }[]) =>
  req<TermsAdded>("POST", "/api/terms", { terms: list })

export const removeTerm = (name: string) => req<void>("DELETE", `/api/terms/${segment(name)}`)

/** A text file (one term per line, `name,type`, or JSON) as the request body, which `req` can't send. */
export async function uploadTerms(text: string): Promise<TermsAdded> {
  const res = await fetch("/api/terms/upload", {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: text,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const j = (await res.json()) as { detail?: unknown }
      if (typeof j.detail === "string") detail = j.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as TermsAdded
}
