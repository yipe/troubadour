import { ChevronsUpDown } from "lucide-react"
import { useCampaigns } from "@troubadour/api/campaigns"

/** Placeholder at the final size; S11 adds the menu. */
export function CampaignSwitcher() {
  const data = useCampaigns().data
  const name = data?.campaigns.find((c) => c.id === data.campaign)?.name ?? ""
  return (
    <button
      type="button"
      className="flex h-8 items-center gap-2 rounded-control border border-line bg-surface px-2.5 text-13 font-semibold text-ink"
    >
      <span className="size-2 rounded-[2px]" style={{ background: "var(--color-class-warlock)" }} />
      {name}
      <ChevronsUpDown size={14} className="text-ink-subtle" />
    </button>
  )
}
