import type { Recap } from "@troubadour/api/recap"
import { hms } from "../../lib/format.ts"

/** The recap as Discord Markdown: heading, body, the quote, then the moments and open questions as bullets. */
export function discordMarkdown(recap: Recap, playerNames: Map<string, string>): string {
  const parts = [`## ${recap.title}`, recap.body.trim()]
  if (recap.quote) {
    parts.push(`> “${recap.quote.text}” — ${recap.quote.speaker}, ${hms(recap.quote.t)}`)
  }
  if (recap.moments.length) {
    parts.push(
      recap.moments.map((m) => `- **${playerNames.get(m.player_id) ?? "Someone"}**: ${m.text}`).join("\n"),
    )
  }
  if (recap.questions.length) {
    parts.push(`**Open questions**\n${recap.questions.map((q) => `- ${q}`).join("\n")}`)
  }
  return parts.filter(Boolean).join("\n\n")
}
