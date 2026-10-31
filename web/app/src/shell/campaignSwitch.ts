import { paths } from "../paths.ts"

/**
 * Where to go when another campaign opens while `pathname` is showing: a codex entry or a saved
 * session of the old campaign means nothing in the new one. null = stay.
 */
export function campaignSwitchTarget(pathname: string): string | null {
  if (pathname.startsWith("/codex/")) return paths.codex()
  const [, first, second] = pathname.split("/")
  if (first === "sessions" && second && second !== "new" && second !== "live") return paths.sessions()
  return null
}
