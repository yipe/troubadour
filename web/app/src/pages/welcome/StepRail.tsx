import { Link } from "react-router"
import { Check, Lock } from "lucide-react"
import { NavItem } from "@troubadour/ui/nav-item"
import { cn } from "@troubadour/ui/cn"
import { WELCOME_STEPS, paths, type WelcomeStep } from "../../paths.ts"
import { STEPS, stepIndex, stepState, type StepState } from "./steps.ts"

const DOT: Record<StepState, string> = {
  done: "bg-success-soft text-success",
  current: "bg-accent-strong text-ink-on-accent",
  upcoming: "text-ink-subtle shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]",
}

/** The five steps. Finished ones link back; the rest wait their turn. */
export function StepRail({
  current,
  campaignName,
  tableName,
}: {
  current: WelcomeStep
  campaignName?: string
  tableName: string
}) {
  return (
    <nav aria-label="Setup steps" className="flex h-full flex-col gap-1 px-5 py-7">
      {WELCOME_STEPS.map((id) => {
        const state = stepState(id, current)
        const info = STEPS[id]
        const sub = id === "campaign" && state === "done" && campaignName ? campaignName : info.sub
        const dot = (
          <span
            data-state={state}
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-12 font-bold",
              DOT[state],
            )}
          >
            {state === "done" ? <Check className="size-3.5" aria-hidden /> : stepIndex(id) + 1}
          </span>
        )
        const common = {
          icon: dot,
          sub,
          selected: state === "current",
          className: cn("items-start gap-3 py-2.5", state === "upcoming" && "text-ink-muted"),
        }
        return state === "done" ? (
          <NavItem key={id} {...common} render={<Link to={paths.welcome(id)} />}>
            {id === "table" ? tableName : info.title}
          </NavItem>
        ) : (
          <NavItem key={id} {...common} disabled={state === "upcoming"}>
            {id === "table" ? tableName : info.title}
          </NavItem>
        )
      })}
      <div className="flex-1" />
      <p className="flex gap-2 px-3 text-12 text-ink-subtle">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Everything here stays on this Mac unless you choose a hosted model in step 5.</span>
      </p>
    </nav>
  )
}
