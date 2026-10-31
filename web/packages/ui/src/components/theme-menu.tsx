import { Fragment, type ReactNode } from "react"
import type { ThemeChoice } from "../lib/theme-choice"
import { useThemeChoice } from "../lib/use-theme-choice"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { CircleDotIcon, CircleHalfStrokeIcon, MoonIcon, SunIcon } from "./theme-icons"
import { Tooltip } from "./tooltip"
import { topBarButton } from "./top-bar"

/** DPRcalc's theme menu: the three themes, then a separated Auto (our `system`) that follows the OS. */
const OPTIONS: { id: ThemeChoice; label: string; icon: ReactNode }[] = [
  { id: "dark", label: "Dark", icon: <MoonIcon /> },
  { id: "light", label: "Light", icon: <SunIcon /> },
  { id: "midnight", label: "Midnight", icon: <CircleDotIcon /> },
  { id: "system", label: "Auto", icon: <CircleHalfStrokeIcon /> },
]

export function ThemeMenu() {
  const [choice, setChoice] = useThemeChoice()
  return (
    <DropdownMenu>
      <Tooltip content="Theme">
        <DropdownMenuTrigger aria-label="Theme" className={topBarButton}>
          <CircleHalfStrokeIcon width={20} height={20} />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        {OPTIONS.map((o) => (
          <Fragment key={o.id}>
            {o.id === "system" && <DropdownMenuSeparator />}
            <DropdownMenuItem
              icon={o.icon}
              className={choice === o.id ? "font-bold" : undefined}
              onClick={() => setChoice(o.id)}
            >
              {o.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
