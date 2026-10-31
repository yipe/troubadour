import { Link, useLocation } from "react-router"
import { useLive } from "@troubadour/api/live"
import { StatusDot } from "@troubadour/ui/status-dot"
import { ThemeMenu } from "@troubadour/ui/theme-menu"
import { TopBar } from "@troubadour/ui/top-bar"
import { UnderlineTabs, type TabItem } from "@troubadour/ui/underline-tabs"
import { LuteIcon } from "@troubadour/ui/lute-icon"
import { Wordmark } from "@troubadour/ui/wordmark"
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
    <TopBar className="xl:flex-nowrap">
      <Link to={paths.home()} className="flex items-center gap-2 px-2 text-ink hover:text-ink">
        <LuteIcon size={28} />
        <Wordmark className="max-sm:sr-only" />
      </Link>
      <CampaignSwitcher />
      <nav className="order-last flex w-full min-w-0 items-center overflow-x-auto overflow-y-hidden py-1 xl:order-none xl:w-auto xl:overflow-visible">
        <UnderlineTabs
          size="nav"
          items={items}
          value={activeTab(pathname)}
          className="items-center gap-1"
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
      <ThemeMenu />
      <AccountMenu />
    </TopBar>
  )
}
