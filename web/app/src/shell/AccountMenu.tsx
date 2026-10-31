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
import { Avatar } from "@troubadour/ui/avatar"
import { ConfirmDialog } from "@troubadour/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { initials } from "../lib/players.ts"
import { paths } from "../paths.ts"

/** Accounts are DPRcalc's: name, email, avatar and password are managed there. */
const MANAGE_ACCOUNT_URL = "https://accounts.dprcalc.com/user"

/** DPRcalc's round mark, in the current text colour. */
function DprcalcMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 88 89" aria-hidden="true" className={className} fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M76.7528 14.9002C83.7459 22.6904 88 32.9894 88 44.282C88 68.5826 68.3005 88.282 44 88.282C35.6893 88.282 27.9167 85.978 21.2863 81.9737L15.3884 87.0521C14.5187 87.801 13.2784 86.7338 13.8892 85.7622L22.556 71.9745L22.5485 71.9656C22.5514 71.9678 22.5544 71.9701 22.5573 71.9724L35.1199 51.9871C35.5385 51.3211 35.0599 50.4549 34.2733 50.4549H19.8769C18.9505 50.4549 18.5222 49.304 19.2231 48.6983L60.245 13.2494C55.3897 10.7025 49.8631 9.26163 44 9.26163C24.6588 9.26163 8.97959 24.9408 8.97959 44.282C8.97959 52.5687 11.8577 60.1831 16.6689 66.1802L11.7467 74.211C4.45724 66.3591 0 55.8411 0 44.282C0 19.9815 19.6995 0.282043 44 0.282043C52.6142 0.282043 60.6502 2.75747 67.4355 7.03577L72.5813 2.58901C73.4507 1.83776 74.6934 2.9057 74.0815 3.87819L53.421 36.7143C53.002 37.3802 53.4806 38.2468 54.2674 38.2468H69.3753C70.3026 38.2468 70.7305 39.3996 70.0278 40.0046L28.5503 75.719C33.2103 78.0136 38.4546 79.3025 44 79.3025C63.3412 79.3025 79.0204 63.6233 79.0204 44.282C79.0204 36.2682 76.3286 28.883 71.7999 22.9813L76.7528 14.9002Z"
      />
    </svg>
  )
}

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
  const { name, email } = account ?? {}
  return (
    <>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <AccountAvatar size={30} />
        <div className="min-w-0">
          <p className="truncate text-13 font-semibold text-ink">{name ?? email ?? "Signed in"}</p>
          {name && email ? <p className="truncate text-12 text-ink-muted">{email}</p> : null}
        </div>
      </div>
      <p className="flex items-center gap-1.5 px-2.5 pb-1.5 text-12 text-ink-muted">
        <DprcalcMark className="size-3.5" /> Signed in with DPRcalc
      </p>
      <DropdownMenuSeparator />
    </>
  )
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
        <DropdownMenuTrigger
          aria-label="Account"
          className="flex size-[30px] items-center justify-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
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
