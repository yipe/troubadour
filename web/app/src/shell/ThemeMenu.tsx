import { Fragment, type ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@troubadour/ui/dropdown-menu"
import { Tooltip } from "@troubadour/ui/tooltip"
import { CircleDotIcon, CircleHalfStrokeIcon, MoonIcon, SunIcon } from "./ThemeIcons.tsx"
import { useThemeChoice, type ThemeChoice } from "../lib/theme.ts"

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
        <DropdownMenuTrigger
          aria-label="Theme"
          className="flex size-[30px] items-center justify-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
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
