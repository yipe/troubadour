import { paths } from "../paths.ts"

export const TABS = [
  { id: "home", label: "Home", to: paths.home() },
  { id: "sessions", label: "Sessions", to: paths.sessions() },
  { id: "timeline", label: "Timeline", to: paths.timeline() },
  { id: "codex", label: "Codex", to: paths.codex() },
  { id: "facts", label: "Facts", to: paths.facts() },
  { id: "ask", label: "Ask", to: paths.ask() },
] as const

/** Which tab a URL belongs to; "" for pages with no tab (settings). */
export function activeTab(pathname: string): string {
  if (pathname === "/") return "home"
  const first = pathname.split("/")[1] ?? ""
  return TABS.some((t) => t.id === first) ? first : ""
}
