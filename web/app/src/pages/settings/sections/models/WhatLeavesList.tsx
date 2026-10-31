import { Check } from "lucide-react"
import { useCloud } from "@troubadour/api/cloud"
import { useLlm } from "@troubadour/api/llm"
import { cn } from "@troubadour/ui/cn"

interface Row {
  what: string
  answer: string
  /** True when something does leave this computer. */
  leaves: boolean
}

/** What goes off this computer, from the language model in use and the cloud backup. The LLM and backup state come
 * from the server; audio and voiceprints are fixed because nothing can send them. */
function whatLeaves(hostedLabel: string | null, cloud: { on: boolean; transcripts: boolean }): Row[] {
  const text: Row = hostedLabel
    ? { what: "", answer: `Sent to ${hostedLabel}`, leaves: true }
    : { what: "", answer: "Never with a local model", leaves: false }
  return [
    { what: "Audio recordings", answer: "Never", leaves: false },
    { what: "Voiceprints", answer: "Never", leaves: false },
    { ...text, what: "Transcripts & notes" },
    { ...text, what: "Questions you ask" },
    {
      what: "Cloud backup",
      answer: cloud.on ? `On: notes and write-ups${cloud.transcripts ? " and transcripts" : ""}` : "Off",
      leaves: cloud.on,
    },
  ]
}

export function WhatLeavesList() {
  const llm = useLlm()
  const cloud = useCloud()
  const hosted =
    llm.data && llm.data.provider !== "local"
      ? (llm.data.providers.find((p) => p.id === llm.data.provider)?.label ?? llm.data.provider)
      : null
  const rows = whatLeaves(hosted, {
    on: cloud.data?.connected ?? false,
    transcripts: cloud.data?.include_transcripts ?? false,
  })
  return (
    <section aria-labelledby="what-leaves">
      <h2 id="what-leaves" className="mb-3 font-serif text-18 font-bold text-ink">
        What leaves this computer
      </h2>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.what} className="flex items-start gap-2.5 px-3 py-2.5 text-14">
            <Check
              aria-hidden
              className={cn("mt-0.5 size-4 shrink-0", r.leaves ? "text-warning" : "text-success")}
            />
            <span className="min-w-0 flex-1 text-ink">{r.what}</span>
            <span className={cn("text-right", r.leaves ? "text-warning" : "text-ink-muted")}>{r.answer}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
