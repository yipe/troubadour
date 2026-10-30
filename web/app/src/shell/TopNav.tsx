import { Feather } from "lucide-react"
import { Link, useLocation } from "react-router"
import { useLive } from "@troubadour/api/live"
import { StatusDot } from "@troubadour/ui/status-dot"
import { UnderlineTabs, type TabItem } from "@troubadour/ui/underline-tabs"
import { paths } from "../paths.ts"
import { AccountMenu } from "./AccountMenu.tsx"
import { AiStatus } from "./AiStatus.tsx"
import { CampaignSwitcher } from "./CampaignSwitcher.tsx"
import { CloudChip } from "./CloudChip.tsx"
import { RecordingPill } from "./RecordingPill.tsx"
import { activeTab, TABS } from "./tabs.ts"

export function TopNav() {
  const { pathname } = useLocation()
  const running = useLive((s) => s.session?.status === "running")
  const items: TabItem[] = TABS.map((t) => ({ id: t.id, label: t.label }))
  return (
    <header className="flex h-14 shrink-0 items-center gap-5 border-b border-line bg-canvas px-5 whitespace-nowrap">
      <Link
        to={paths.home()}
        className="flex items-center gap-2 font-serif text-[18px] font-bold text-ink hover:text-ink"
      >
        <Feather size={20} className="text-accent" />
        Troubadour
      </Link>
      <CampaignSwitcher />
      <nav className="flex h-full items-end">
        <UnderlineTabs
          size="nav"
          items={items}
          value={activeTab(pathname)}
          className="gap-[18px]"
          renderItem={(item, props, content) => (
            <Link to={TABS.find((t) => t.id === item.id)!.to} {...props}>
              {content}
              {item.id === "sessions" && running && <StatusDot tone="danger" aria-label="Recording" />}
            </Link>
          )}
        />
      </nav>
      <div className="flex-1" />
      <RecordingPill />
      <CloudChip />
      <AiStatus />
      <AccountMenu />
    </header>
  )
}
