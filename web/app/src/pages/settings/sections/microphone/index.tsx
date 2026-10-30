import { useState } from "react"
import { PageHeading } from "@troubadour/ui/page-heading"
import type { Source } from "@troubadour/api/session"
import { MicCard } from "../../../../components/mic/MicCard.tsx"
import { MicDetails } from "./MicDetails.tsx"

export function Component() {
  // Only a microphone can be picked here; replaying files belongs to the Ready screen.
  const [device, setDevice] = useState<Source>({ kind: "mic", device: null })
  return (
    <div className="flex max-w-[760px] flex-col gap-6 p-8">
      <PageHeading tone="accent" title="Microphone" subtitle="How Troubadour hears the table." />
      <MicCard mode="settings" device={device} onDeviceChange={setDevice} />
      <MicDetails device={device.kind === "mic" ? (device.device ?? null) : null} />
    </div>
  )
}
