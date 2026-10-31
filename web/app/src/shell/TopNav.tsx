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
    // Below `xl` the tabs drop to a second row that scrolls sideways, and below `lg` the cloud and
    // model chips give way, so the recording pill and the account menu stay on the first row.
    <header className="flex shrink-0 flex-wrap items-center gap-x-5 border-b border-line bg-canvas px-4 whitespace-nowrap xl:h-14 xl:flex-nowrap xl:px-5">
      <Link
        to={paths.home()}
        className="flex h-14 items-center gap-2 font-serif text-[18px] font-bold text-ink hover:text-ink"
      >
        <Feather size={20} className="text-accent" />
        <span className="max-sm:sr-only">Troubadour</span>
      </Link>
      <CampaignSwitcher />
      <nav className="order-last flex h-11 w-full min-w-0 items-end overflow-x-auto xl:order-none xl:h-full xl:w-auto">
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
      <div className="hidden items-center gap-5 lg:flex">
        <CloudChip />
        <AiStatus />
      </div>
      <AccountMenu />
    </header>
  )
}
