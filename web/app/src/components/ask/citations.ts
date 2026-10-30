import type { AnswerSource } from "@troubadour/api/ask"

export type Piece =
  | { kind: "text"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "cite"; number: number; sourceId: string }

const TOKEN = /(\[S\d+\]|“[^”]+”|"[^"]+")/

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()

/**
 * Splits an answer into text, quoted phrases that appear in a source excerpt, and citations. Citations
 * are numbered 1, 2, … in the order they first appear, whatever ids the model used; a citation of a
 * source that does not exist is dropped. `ordered` lists the sources: cited ones by number, then the rest.
 */
export function parseAnswer(
  answer: string,
  sources: AnswerSource[],
): { pieces: Piece[]; ordered: { number: number; source: AnswerSource }[] } {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const excerpts = sources.map((s) => norm(s.excerpt))
  const numbers = new Map<string, number>()
  const pieces: Piece[] = []
  for (const part of answer.split(TOKEN)) {
    if (!part) continue
    const cite = /^\[(S\d+)\]$/.exec(part)
    if (cite) {
      const id = cite[1]!
      if (!byId.has(id)) continue
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1)
      pieces.push({ kind: "cite", number: numbers.get(id)!, sourceId: id })
    } else if (TOKEN.test(part) && part.length > 2) {
      const inner = norm(part.slice(1, -1))
      const matched = inner.length > 0 && excerpts.some((e) => e.includes(inner))
      pieces.push({ kind: matched ? "quote" : "text", text: part })
    } else {
      pieces.push({ kind: "text", text: part })
    }
  }
  const ordered = [...numbers].map(([id, number]) => ({ number, source: byId.get(id)! }))
  for (const source of sources) {
    if (!numbers.has(source.id)) ordered.push({ number: ordered.length + 1, source })
  }
  return { pieces, ordered }
}
