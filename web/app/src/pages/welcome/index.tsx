import { useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router"
import { ArrowRight, Feather, Info } from "lucide-react"
import { useCampaigns } from "@troubadour/api/campaigns"
import type { Source } from "@troubadour/api/session"
import { Button } from "@troubadour/ui/button"
import { ImportNotes } from "../../components/import-notes/ImportNotes.tsx"
import { MicCard } from "../../components/mic/MicCard.tsx"
import { ModelsSettings } from "../../components/models/ModelsSettings.tsx"
import { PlayersTable } from "../../components/players/PlayersTable.tsx"
import { WELCOME_STEPS, paths, type WelcomeStep } from "../../paths.ts"
import { CAMPAIGN_FORM, CampaignStep } from "./CampaignStep.tsx"
import { useTableName } from "../../lib/table.ts"
import { StepRail } from "./StepRail.tsx"
import { STEPS, isWelcomeStep, stepIndex } from "./steps.ts"

function StepBody({ step, onBusy }: { step: WelcomeStep; onBusy: (busy: boolean) => void }) {
  const [device, setDevice] = useState<Source>({ kind: "mic", device: null })
  switch (step) {
    case "campaign":
      return <CampaignStep onBusy={onBusy} />
    case "table":
      return (
        <>
          <PlayersTable mode="wizard" />
          <p className="flex items-start gap-2.5 text-13 text-ink-subtle">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            The player colour comes from their class, so lines, charts and recaps match the rest of the app.
            Quiet players get a 20-second training option on the next step.
          </p>
        </>
      )
    case "microphone":
      return <MicCard mode="wizard" device={device} onDeviceChange={setDevice} />
    case "notes":
      return <ImportNotes />
    case "privacy":
      return <ModelsSettings />
  }
}

export function Component() {
  const { step } = useParams()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const campaigns = useCampaigns().data
  const tableName = useTableName()
  if (!isWelcomeStep(step)) return <Navigate to={paths.welcome("campaign")} replace />

  const index = stepIndex(step)
  const info = STEPS[step]
  const prev = WELCOME_STEPS[index - 1]
  const next = WELCOME_STEPS[index + 1]
  const campaignName = campaigns?.campaigns.find((c) => c.id === campaigns.campaign)?.name

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <Feather size={20} className="text-accent" />
        <span className="font-serif text-[18px] font-bold">Troubadour</span>
        <span className="ml-2 text-ink-subtle">New campaign</span>
        <span className="ml-auto text-13 text-ink-subtle">
          Saved as you go ·{" "}
          <Link to={paths.home()} className="text-accent no-underline hover:text-ink">
            Finish later
          </Link>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[300px] shrink-0 overflow-auto border-r border-line">
          <StepRail current={step} campaignName={campaignName} tableName={tableName} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-auto px-14 py-9">
          <div>
            <div className="text-12 font-bold tracking-[0.08em] text-ink-subtle uppercase">
              Step {index + 1} of {WELCOME_STEPS.length}
            </div>
            <h1 className="mt-1.5 mb-1 font-serif text-30 font-bold">{info.heading}</h1>
            <p className="max-w-[640px] text-ink-muted">{info.explainer}</p>
          </div>
          <StepBody key={step} step={step} onBusy={setSaving} />
          <div className="flex-1" />
          <div className="flex justify-end gap-2.5 border-t border-line pt-[18px]">
            {prev && (
              <Button size="lg" variant="ghost" onClick={() => void navigate(paths.welcome(prev))}>
                Back
              </Button>
            )}
            {step === "notes" && next && (
              <Button size="lg" variant="ghost" onClick={() => void navigate(paths.welcome(next))}>
                Skip
              </Button>
            )}
            {step === "campaign" ? (
              <Button size="lg" variant="primary" type="submit" form={CAMPAIGN_FORM} disabled={saving}>
                Continue to {STEPS.table.continueTo}
                <ArrowRight className="size-4" />
              </Button>
            ) : next ? (
              <Button size="lg" variant="primary" onClick={() => void navigate(paths.welcome(next))}>
                Continue to {STEPS[next].continueTo}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button size="lg" variant="primary" onClick={() => void navigate(paths.home())}>
                Finish
              </Button>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
