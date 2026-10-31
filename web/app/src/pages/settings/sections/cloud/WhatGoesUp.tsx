import { AudioLines, Fingerprint, MessagesSquare, NotebookText, ScrollText } from "lucide-react"
import type { ReactNode } from "react"
import { useCloud, useCloudOptions } from "@troubadour/api/cloud"
import { Badge } from "@troubadour/ui/badge"
import { Switch } from "@troubadour/ui/switch"

function Row({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-line bg-surface px-4 py-3 last:border-b-0">
      <span className="text-ink-muted">{icon}</span>
      <div className="flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-12 text-ink-subtle">{detail}</div>
      </div>
      {children}
    </div>
  )
}

export function WhatGoesUp() {
  const status = useCloud().data!
  const options = useCloudOptions()
  return (
    <section className="overflow-hidden rounded-card border border-line">
      <h2 className="border-b border-line bg-sunken px-4 py-2.5 font-serif font-bold">What goes up</h2>
      <Row
        icon={<NotebookText size={18} aria-hidden />}
        title="Notes, codex entries and facts"
        detail="Everything in the Obsidian vault folder"
      >
        <Badge tone="success">Always</Badge>
      </Row>
      <Row
        icon={<ScrollText size={18} aria-hidden />}
        title="Session write-ups and recaps"
        detail="One page per reviewed session"
      >
        <Badge tone="success">Always</Badge>
      </Row>
      <Row
        icon={<MessagesSquare size={18} aria-hidden />}
        title="Transcripts"
        detail="Everything said at the table. Off: only notes and write-ups."
      >
        <Switch
          aria-label="Transcripts"
          checked={status.include_transcripts}
          onCheckedChange={(include_transcripts) => options.mutate({ include_transcripts })}
        />
      </Row>
      <Row
        icon={<AudioLines size={18} aria-hidden />}
        title="Audio recordings"
        detail="Stay on this computer"
      >
        <Badge tone="neutral">Never</Badge>
      </Row>
      <Row icon={<Fingerprint size={18} aria-hidden />} title="Voiceprints" detail="Stay on this computer">
        <Badge tone="neutral">Never</Badge>
      </Row>
    </section>
  )
}
