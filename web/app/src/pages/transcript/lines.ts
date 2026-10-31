import type { ViewLine } from "../../components/transcript/viewLines.ts"

/** The line being spoken at `t` seconds: the last one that starts at or before it, else the first. */
export function lineAt(lines: ViewLine[], t: number): ViewLine | null {
  let found: ViewLine | null = lines[0] ?? null
  for (const line of lines) {
    if (line.t > t) break
    found = line
  }
  return found
}

/** `?t=` as seconds; null when absent or not a non-negative number. */
export function parseSeconds(value: string | null): number | null {
  if (value == null || value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Lines whose text contains `query`, ignoring case. An empty query keeps every line. */
export function filterLines(lines: ViewLine[], query: string): ViewLine[] {
  const q = query.trim().toLocaleLowerCase("en-US")
  if (!q) return lines
  return lines.filter((l) => l.text.toLocaleLowerCase("en-US").includes(q))
}
