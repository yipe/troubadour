import { lazy, Suspense, type ComponentType } from "react"
import { BookMarked, BookOpen, Cloud, Mic, ShieldCheck, Users } from "lucide-react"
import { Link, useParams } from "react-router"
import { NavItem } from "@troubadour/ui/nav-item"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { Spinner } from "@troubadour/ui/spinner"
import { paths, SETTINGS_SECTIONS, type SettingsSection } from "../../paths.ts"

const sections: Record<SettingsSection, ComponentType> = {
  models: lazy(() => import("./sections/models/index.tsx").then((m) => ({ default: m.Component }))),
  microphone: lazy(() => import("./sections/microphone/index.tsx").then((m) => ({ default: m.Component }))),
  players: lazy(() => import("./sections/players/index.tsx").then((m) => ({ default: m.Component }))),
  content: lazy(() => import("./sections/content/index.tsx").then((m) => ({ default: m.Component }))),
  vault: lazy(() => import("./sections/vault/index.tsx").then((m) => ({ default: m.Component }))),
  cloud: lazy(() => import("./sections/cloud/index.tsx").then((m) => ({ default: m.Component }))),
}

const nav: { id: SettingsSection; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "models", label: "Models & privacy", icon: ShieldCheck },
  { id: "microphone", label: "Microphone", icon: Mic },
  { id: "players", label: "Players & voices", icon: Users },
  { id: "content", label: "Content", icon: BookMarked },
  { id: "vault", label: "Obsidian vault", icon: BookOpen },
  { id: "cloud", label: "Troubadour Cloud", icon: Cloud },
]

/** An unknown section falls back to models. */
function sectionOf(param: string | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s === param) ?? "models"
}

export function Component() {
  const current = sectionOf(useParams().section)
  const Section = sections[current]
  return (
    <RailLayout
      railWidth={260}
      rail={
        <nav aria-label="Settings" className="p-3">
          <div className="px-3 pt-2 pb-3 text-12 font-bold tracking-[0.08em] text-ink-subtle uppercase">
            Settings
          </div>
          <div className="flex flex-col gap-0.5">
            {nav.map(({ id, label, icon: Icon }) => (
              <NavItem
                key={id}
                selected={id === current}
                icon={<Icon className="size-4" />}
                render={<Link to={paths.settings(id)} />}
              >
                {label}
              </NavItem>
            ))}
          </div>
        </nav>
      }
    >
      <Suspense fallback={<Spinner />}>
        <Section />
      </Suspense>
    </RailLayout>
  )
}
