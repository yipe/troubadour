import { CircleUser, ExternalLink, LogOut, Mic, Settings, Cloud } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import {
  openSignInTab,
  useCloud,
  useCloudAccount,
  useCloudConnect,
  useCloudDisconnect,
} from "@troubadour/api/cloud"
import { useLive } from "@troubadour/api/live"
import { AccountSummary } from "@troubadour/ui/account-summary"
import { Avatar } from "@troubadour/ui/avatar"
import { DprcalcMark } from "@troubadour/ui/dprcalc-mark"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { topBarButton } from "@troubadour/ui/top-bar"
import { initials } from "../lib/players.ts"
import { paths } from "../paths.ts"

/** Accounts are DPRcalc's: name, email, avatar and password are managed there. */
const MANAGE_ACCOUNT_URL = "https://accounts.dprcalc.com/user"

/**
 * The signed-in account's avatar (DPRcalc's picture, fetched by the server so the page never contacts the
 * image host). Only rendered when connected: asking for the account while signed out would be a wasted call.
 */
function AccountAvatar({ size }: { size: 24 | 30 }) {
  const { data: account } = useCloudAccount()
  const label = account?.name ?? account?.email ?? "?"
  return (
    <Avatar
      initials={initials(label)}
      color="var(--color-ink-muted)"
      size={size}
      src={account?.avatar ?? undefined}
    />
  )
}

function AccountHeader() {
  const { data: account } = useCloudAccount()
  return <AccountSummary name={account?.name} email={account?.email} avatar={<AccountAvatar size={30} />} />
}

/**
 * Header account menu. Signed out it is a plain user icon that offers Sign in; nothing reaches the cloud
 * service until then. Signed in it shows who, and Disconnect (after a confirmation).
 */
export function AccountMenu() {
  const navigate = useNavigate()
  const { data: status } = useCloud()
  const connect = useCloudConnect()
  const disconnect = useCloudDisconnect()
  const gm = useLive((s) => s.players.find((p) => p.is_gm))
  const [confirming, setConfirming] = useState(false)
  const connected = !!status?.connected

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Account" className={topBarButton}>
          {connected ? (
            <AccountAvatar size={30} />
          ) : gm ? (
            <Avatar initials={initials(gm.name)} color="var(--color-ink-muted)" size={30} />
          ) : (
            <CircleUser size={20} />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          {connected ? <AccountHeader /> : null}
          <DropdownMenuItem icon={<Settings />} onClick={() => void navigate(paths.settings("models"))}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Mic />} onClick={() => void navigate(paths.settings("players"))}>
            Players &amp; voices
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Cloud />} onClick={() => void navigate(paths.settings("cloud"))}>
            Troubadour Cloud
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {connected ? (
            <>
              <DropdownMenuItem
                icon={<ExternalLink />}
                render={<a href={`${status.url}/vaults`} target="_blank" rel="noreferrer" />}
              >
                Open Troubadour Cloud
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<DprcalcMark />}
                render={<a href={MANAGE_ACCOUNT_URL} target="_blank" rel="noreferrer" />}
              >
                Manage on DPRcalc
              </DropdownMenuItem>
              <DropdownMenuItem icon={<LogOut />} danger onClick={() => setConfirming(true)}>
                Disconnect cloud
              </DropdownMenuItem>
            </>
          ) : (
            // The sign-in tab must open during the click, before any await, or pop-up blockers stop it.
            <DropdownMenuItem icon={<DprcalcMark />} onClick={() => connect.mutate(openSignInTab())}>
              Sign in with DPRcalc
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Outside the menu: its popup unmounts when it closes. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect Troubadour Cloud?"
        body="Backups stop and this computer forgets the sign-in. Backups already in the cloud are kept."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={async () => {
          await disconnect.mutateAsync()
        }}
      />
    </>
  )
}
